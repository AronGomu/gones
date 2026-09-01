using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;
using Gones.Domain.Calendar;
using Gones.Domain.Catalog;
using Gones.Domain.Leagues;
using Gones.Domain.Live;
using NodaTime;

namespace Gones.Application.Migration;

/// <summary>
/// Pure evaluation of a migration batch: merges bundles under the operator manifest, applies the
/// per-event mapping, plans every write, and produces the review report. Never touches a database.
/// </summary>
public static partial class MigrationPlanner
{
    [GeneratedRegex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")]
    private static partial Regex DateRegex();

    [GeneratedRegex(@"<img\b", RegexOptions.IgnoreCase)]
    private static partial Regex ImageTagRegex();

    [GeneratedRegex("<[^>]*>")]
    private static partial Regex HtmlTagRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    public static MigrationEvaluation Evaluate(
        IReadOnlyList<MigrationBundleFile> bundles,
        MigrationManifestFile manifest,
        MigrationMappingFile mapping,
        MigrationTargetState target,
        string mode,
        string generatedAt)
    {
        var errors = new List<MigrationReportIssue>();
        var warnings = new List<MigrationReportIssue>();
        var deduplicates = new List<string>();
        var conflicts = new List<MigrationReportIssue>();
        var collisions = new List<string>();
        var sanitation = new List<MigrationSanitationChange>();
        var usedResolutionKeys = new HashSet<string>(StringComparer.Ordinal);
        var skippedEntities = 0;

        ValidateManifestAgainstBundles(bundles, manifest, errors);

        var selectedLeagues = SelectEntities(bundles, manifest, bundle => bundle.Leagues, "league", errors, warnings, deduplicates, conflicts, usedResolutionKeys, ref skippedEntities);
        var selectedLive = SelectEntities(bundles, manifest, bundle => bundle.LiveTournaments, "live", errors, warnings, deduplicates, conflicts, usedResolutionKeys, ref skippedEntities);
        var selectedEvents = SelectEntities(bundles, manifest, bundle => bundle.CalendarEvents, "calendarEvent", errors, warnings, deduplicates, conflicts, usedResolutionKeys, ref skippedEntities);

        var (leaguesToCreate, standaloneTournaments) = PlanLeagues(
            selectedLeagues, mapping, manifest, target, errors, warnings, collisions, usedResolutionKeys, ref skippedEntities);
        var liveToCreate = PlanLiveTournaments(selectedLive, manifest, target, errors, warnings, collisions, usedResolutionKeys, ref skippedEntities);
        var (scheduled, mappingSummaries) = PlanScheduledTournaments(selectedEvents, mapping, target, errors, warnings, collisions, sanitation);
        var (archetypesToAdd, archetypesPresent) = PlanDeckArchetypes(bundles, target);

        foreach (var resolutionKey in manifest.Resolutions.Keys.Where(key => !usedResolutionKeys.Contains(key)))
        {
            errors.Add(new MigrationReportIssue("unknownResolutionKey", $"manifest resolution '{resolutionKey}' matches no duplicate, conflict, or collision"));
        }

        foreach (var bundle in bundles.Where(bundle => bundle.StoreErrors.Count > 0))
        {
            warnings.Add(new MigrationReportIssue("bundleStoreErrors", $"{bundle.FileName}: source stores failed to parse on export: {string.Join(", ", bundle.StoreErrors)}"));
        }

        var batchHash = ComputeBatchHash(bundles, manifest, mapping);
        var report = BuildReport(
            bundles, manifest, mapping, target, mode, generatedAt, batchHash,
            leaguesToCreate, standaloneTournaments, scheduled, liveToCreate,
            archetypesToAdd, archetypesPresent, skippedEntities, mappingSummaries,
            deduplicates, conflicts, collisions, sanitation, warnings, errors);

        var plan = new MigrationPlan(
            batchHash,
            leaguesToCreate,
            standaloneTournaments,
            scheduled,
            liveToCreate,
            archetypesToAdd);
        return new MigrationEvaluation(plan, report);
    }

    private static void ValidateManifestAgainstBundles(
        IReadOnlyList<MigrationBundleFile> bundles,
        MigrationManifestFile manifest,
        List<MigrationReportIssue> errors)
    {
        var seenInstances = new HashSet<string>(StringComparer.Ordinal);
        foreach (var bundle in bundles)
        {
            if (!seenInstances.Add(bundle.SourceInstanceId))
            {
                errors.Add(new MigrationReportIssue("duplicateSourceInstance", $"source instance {bundle.SourceInstanceId} appears in more than one bundle file"));
                continue;
            }

            var declared = manifest.SourceInstances.FirstOrDefault(instance => instance.SourceInstanceId == bundle.SourceInstanceId);
            if (declared is null)
            {
                errors.Add(new MigrationReportIssue("bundleNotInManifest", $"{bundle.FileName}: source instance {bundle.SourceInstanceId} is not inventoried in the manifest"));
            }
            else if (!string.Equals(declared.BundleChecksum, bundle.BundleChecksum, StringComparison.Ordinal))
            {
                errors.Add(new MigrationReportIssue("manifestChecksumMismatch", $"{bundle.FileName}: manifest expects {declared.BundleChecksum} but bundle is {bundle.BundleChecksum}"));
            }
        }

        foreach (var instance in manifest.SourceInstances.Where(instance => bundles.All(bundle => bundle.SourceInstanceId != instance.SourceInstanceId)))
        {
            errors.Add(new MigrationReportIssue("manifestBundleMissing", $"manifest lists source instance {instance.SourceInstanceId} but no bundle file was supplied for it"));
        }
    }

    private sealed record SelectedEntity(string Id, string SourceInstanceId, JsonElement Element);

    private static List<SelectedEntity> SelectEntities(
        IReadOnlyList<MigrationBundleFile> bundles,
        MigrationManifestFile manifest,
        Func<MigrationBundleFile, IReadOnlyList<JsonElement>> selector,
        string entityKind,
        List<MigrationReportIssue> errors,
        List<MigrationReportIssue> warnings,
        List<string> deduplicates,
        List<MigrationReportIssue> conflicts,
        HashSet<string> usedResolutionKeys,
        ref int skippedEntities)
    {
        var byId = new Dictionary<string, List<(MigrationBundleFile Bundle, JsonElement Element)>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var bundle in bundles)
        {
            foreach (var element in selector(bundle))
            {
                var id = MigrationBundleReader.EntityId(element);
                if (id is null)
                {
                    errors.Add(new MigrationReportIssue("bundleSchemaInvalid", $"{bundle.FileName}: {entityKind} without string id"));
                    continue;
                }

                if (!byId.TryGetValue(id, out var list))
                {
                    byId[id] = list = [];
                    order.Add(id);
                }

                list.Add((bundle, element));
            }
        }

        var selected = new List<SelectedEntity>();
        foreach (var id in order)
        {
            var sources = byId[id];
            var resolutionKey = $"{entityKind}:{id}";
            if (sources.Count == 1)
            {
                selected.Add(new SelectedEntity(id, sources[0].Bundle.SourceInstanceId, sources[0].Element));
                continue;
            }

            var canonicalForms = sources.Select(source => CanonicalJson.Stringify(source.Element)).ToArray();
            if (canonicalForms.Distinct(StringComparer.Ordinal).Count() == 1)
            {
                deduplicates.Add(resolutionKey);
                selected.Add(new SelectedEntity(id, sources[0].Bundle.SourceInstanceId, sources[0].Element));
                continue;
            }

            if (!manifest.Resolutions.TryGetValue(resolutionKey, out var resolution))
            {
                conflicts.Add(new MigrationReportIssue(resolutionKey, $"differs between source instances {string.Join(", ", sources.Select(source => source.Bundle.SourceInstanceId))}"));
                errors.Add(new MigrationReportIssue("unresolvedConflict", $"{resolutionKey} differs across bundles; add a manifest resolution ('skip' or 'use:<sourceInstanceId>')"));
                continue;
            }

            usedResolutionKeys.Add(resolutionKey);
            if (resolution == "skip")
            {
                conflicts.Add(new MigrationReportIssue(resolutionKey, "resolved: skip"));
                warnings.Add(new MigrationReportIssue("skippedEntity", $"{resolutionKey} skipped by manifest resolution"));
                skippedEntities++;
                continue;
            }

            var useInstance = resolution["use:".Length..];
            var chosen = sources.FirstOrDefault(source => source.Bundle.SourceInstanceId == useInstance);
            if (chosen.Bundle is null)
            {
                errors.Add(new MigrationReportIssue("unknownResolution", $"{resolutionKey} resolution references source instance {useInstance}, which does not contain this entity"));
                continue;
            }

            conflicts.Add(new MigrationReportIssue(resolutionKey, $"resolved: use {useInstance}"));
            warnings.Add(new MigrationReportIssue("conflictResolved", $"{resolutionKey} taken from source instance {useInstance}"));
            selected.Add(new SelectedEntity(id, useInstance, chosen.Element));
        }

        return selected;
    }

    private const string UnassignedBundleLeagueId = "placeholder-league";

    private static (List<LeagueDocument> LeaguesToCreate, List<TournamentDocument> StandaloneTournaments) PlanLeagues(
        List<SelectedEntity> selectedLeagues,
        MigrationMappingFile mapping,
        MigrationManifestFile manifest,
        MigrationTargetState target,
        List<MigrationReportIssue> errors,
        List<MigrationReportIssue> warnings,
        List<string> collisions,
        HashSet<string> usedResolutionKeys,
        ref int skippedEntities)
    {
        var normalized = new List<LeagueDocument>();
        List<TournamentDocument> placeholderSourceTournaments = [];
        foreach (var league in selectedLeagues)
        {
            LeagueDocument document;
            try
            {
                document = LeagueNormalizer.Normalize(league.Element, () => throw new InvalidOperationException("bundle league entity lacks an id"));
            }
            catch (Exception exception)
            {
                errors.Add(new MigrationReportIssue("leagueNormalizationFailed", $"league {league.Id}: {exception.Message}"));
                continue;
            }

            // The id a *legacy browser bundle* gave its unassigned League. It is the source format's
            // word, not a row this database has any more: those Tournaments import standalone.
            if (document.Id == UnassignedBundleLeagueId)
            {
                placeholderSourceTournaments = [.. document.Tournaments];
                continue;
            }

            if (target.ExistingLeagueIds.Contains(document.Id))
            {
                var resolutionKey = $"league:{document.Id}";
                if (manifest.Resolutions.TryGetValue(resolutionKey, out var resolution) && resolution == "skip")
                {
                    usedResolutionKeys.Add(resolutionKey);
                    warnings.Add(new MigrationReportIssue("skippedEntity", $"{resolutionKey} already exists in the target database and is skipped by manifest resolution"));
                    skippedEntities++;
                    continue;
                }

                collisions.Add($"league:{document.Id} already exists in the target database");
                errors.Add(new MigrationReportIssue("targetCollision", $"league {document.Id} already exists in the target database; resolve with manifest resolution 'league:{document.Id}': 'skip'"));
                continue;
            }

            normalized.Add(document);
        }

        // The fixed `placeholder-league` row is retired: a bundle Tournament that belonged to no League
        // imports as a standalone Archive Tournament instead of merging into a chosen host, so the
        // mapping no longer carries `placeholderLeagueTarget` and neither target error can arise.
        var standaloneTournaments = new List<TournamentDocument>();
        foreach (var tournament in placeholderSourceTournaments)
        {
            if (target.StandaloneTournamentIds.Contains(tournament.Id))
            {
                var resolutionKey = $"tournament:{tournament.Id}";
                if (manifest.Resolutions.TryGetValue(resolutionKey, out var resolution) && resolution == "skip")
                {
                    usedResolutionKeys.Add(resolutionKey);
                    warnings.Add(new MigrationReportIssue("skippedEntity", $"{resolutionKey} already exists in the target database and is skipped"));
                    skippedEntities++;
                    continue;
                }

                collisions.Add($"tournament:{tournament.Id} already exists in the target database");
                errors.Add(new MigrationReportIssue("targetCollision", $"unassigned Tournament {tournament.Id} already exists in the target database; resolve with 'tournament:{tournament.Id}': 'skip'"));
                continue;
            }

            standaloneTournaments.Add(tournament);
        }

        return (normalized, standaloneTournaments);
    }

    private static List<LiveTournamentDocument> PlanLiveTournaments(
        List<SelectedEntity> selectedLive,
        MigrationManifestFile manifest,
        MigrationTargetState target,
        List<MigrationReportIssue> errors,
        List<MigrationReportIssue> warnings,
        List<string> collisions,
        HashSet<string> usedResolutionKeys,
        ref int skippedEntities)
    {
        var planned = new List<LiveTournamentDocument>();
        foreach (var live in selectedLive)
        {
            LiveTournamentDocument document;
            try
            {
                document = LiveNormalizer.Normalize(
                    live.Element,
                    () => throw new InvalidOperationException("bundle live entity lacks an id"),
                    "1970-01-01T00:00:00.000Z",
                    "1970-01-01");
            }
            catch (Exception exception)
            {
                errors.Add(new MigrationReportIssue("liveNormalizationFailed", $"live {live.Id}: {exception.Message}"));
                continue;
            }

            if (target.ExistingLiveTournamentIds.Contains(document.Id))
            {
                var resolutionKey = $"live:{document.Id}";
                if (manifest.Resolutions.TryGetValue(resolutionKey, out var resolution) && resolution == "skip")
                {
                    usedResolutionKeys.Add(resolutionKey);
                    warnings.Add(new MigrationReportIssue("skippedEntity", $"{resolutionKey} already exists in the target database and is skipped by manifest resolution"));
                    skippedEntities++;
                    continue;
                }

                collisions.Add($"live:{document.Id} already exists in the target database");
                errors.Add(new MigrationReportIssue("targetCollision", $"live tournament {document.Id} already exists in the target database; resolve with 'live:{document.Id}': 'skip'"));
                continue;
            }

            planned.Add(document);
        }

        return planned;
    }

    private static (List<PlannedScheduledTournament> Planned, List<MigrationCalendarMappingSummary> Summaries) PlanScheduledTournaments(
        List<SelectedEntity> selectedEvents,
        MigrationMappingFile mapping,
        MigrationTargetState target,
        List<MigrationReportIssue> errors,
        List<MigrationReportIssue> warnings,
        List<string> collisions,
        List<MigrationSanitationChange> sanitation)
    {
        foreach (var mappedId in mapping.CalendarEvents.Keys.Where(id => selectedEvents.All(entity => entity.Id != id)))
        {
            errors.Add(new MigrationReportIssue("unknownMappedCalendarEvent", $"mapping references calendar event '{mappedId}', which is not in any bundle"));
        }

        var planned = new List<PlannedScheduledTournament>();
        var summaries = new List<MigrationCalendarMappingSummary>();
        var plannedSlugs = new HashSet<string>(StringComparer.Ordinal);
        if (selectedEvents.Count > 0 && !target.OrganizationExists)
        {
            errors.Add(new MigrationReportIssue("unknownOrganization", $"mapping organizationId {mapping.OrganizationId:D} does not exist in the target database"));
        }
        else if (selectedEvents.Count > 0 && !target.OwnerIsOrganizationOwner)
        {
            errors.Add(new MigrationReportIssue("ownerNotOrganizationOwner", $"mapping ownerUserId {mapping.OwnerUserId:D} is not the Owner of organization {mapping.OrganizationId:D}"));
        }

        foreach (var entity in selectedEvents)
        {
            if (!mapping.CalendarEvents.TryGetValue(entity.Id, out var eventMapping))
            {
                errors.Add(new MigrationReportIssue("unmappedCalendarEvent", $"calendar event '{entity.Id}' has no mapping entry; every legacy event needs explicit org/time/zone/format/status mapping"));
                continue;
            }

            var source = LegacyCalendarEvent.From(entity.Element);
            var eventErrors = new List<MigrationReportIssue>();

            var title = source.Title.Trim();
            if (title.Length == 0) eventErrors.Add(Missing(entity.Id, "title"));
            if (title.Length > Event.MaximumTitleLength)
            {
                sanitation.Add(new MigrationSanitationChange(entity.Id, "truncatedTitle", $"title shortened to {Event.MaximumTitleLength} characters"));
                title = title[..Event.MaximumTitleLength];
            }

            var rawSlug = eventMapping.Slug ?? source.Slug;
            var slug = LenientSlug(rawSlug, title);
            if (slug.Length == 0)
            {
                eventErrors.Add(Missing(entity.Id, "slug"));
            }
            else if (!string.Equals(slug, rawSlug, StringComparison.Ordinal))
            {
                sanitation.Add(new MigrationSanitationChange(entity.Id, "slugNormalized", $"'{rawSlug}' became '{slug}'"));
            }

            if (slug.Length > 0 && (target.ExistingTournamentSlugs.Contains(slug) || !plannedSlugs.Add(slug)))
            {
                collisions.Add($"slug:{slug} (calendar event '{entity.Id}')");
                eventErrors.Add(new MigrationReportIssue("slugCollision", $"calendar event '{entity.Id}': slug '{slug}' already exists; supply a unique mapping slug"));
            }

            LocalDate? eventDate = null;
            if (!DateRegex().IsMatch(source.EventDate)
                || !DateTime.TryParseExact(source.EventDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDate))
            {
                eventErrors.Add(new MigrationReportIssue("invalidCalendarField", $"calendar event '{entity.Id}': eventDate '{source.EventDate}' is not yyyy-MM-dd"));
            }
            else
            {
                eventDate = LocalDate.FromDateTime(parsedDate);
            }

            var startTime = ParseTime(eventMapping.StartTime ?? source.StartTime);
            if (startTime is null) eventErrors.Add(new MigrationReportIssue("missingStartTime", $"calendar event '{entity.Id}': no valid start time in source or mapping (expected HH:mm)"));
            var endTime = ParseTime(eventMapping.EndTime ?? source.EndTime);
            if (endTime is not null && startTime is not null && endTime.Value < startTime.Value)
            {
                sanitation.Add(new MigrationSanitationChange(entity.Id, "droppedEndTime", $"end time {endTime.Value:HH:mm} is before start; the venue-day end default applies"));
                endTime = null;
            }

            DateTimeZone? zone = null;
            if (string.IsNullOrWhiteSpace(eventMapping.TimeZone))
            {
                eventErrors.Add(Missing(entity.Id, "timeZone"));
            }
            else
            {
                zone = DateTimeZoneProviders.Tzdb.GetZoneOrNull(eventMapping.TimeZone);
                if (zone is null) eventErrors.Add(new MigrationReportIssue("unknownTimeZone", $"calendar event '{entity.Id}': '{eventMapping.TimeZone}' is not an IANA zone"));
            }

            var address = FirstNonEmpty(eventMapping.Address, source.Address, source.Location);
            if (address is null) eventErrors.Add(Missing(entity.Id, "address"));
            var city = FirstNonEmpty(eventMapping.City, source.City);
            if (city is null) eventErrors.Add(Missing(entity.Id, "city"));
            var country = FirstNonEmpty(eventMapping.Country, source.Country);
            if (country is null) eventErrors.Add(Missing(entity.Id, "country"));

            if (eventMapping.FormatSlugs is null || eventMapping.FormatSlugs.Count == 0)
            {
                eventErrors.Add(new MigrationReportIssue("missingFormatMapping", $"calendar event '{entity.Id}': formatSlugs must be mapped explicitly (the Legacy Format is applied only when explicitly listed)"));
            }
            else
            {
                foreach (var formatSlug in eventMapping.FormatSlugs.Where(formatSlug => !target.FormatIdsBySlug.ContainsKey(formatSlug)))
                {
                    eventErrors.Add(new MigrationReportIssue("unknownFormatSlug", $"calendar event '{entity.Id}': format '{formatSlug}' does not exist in the target catalog"));
                }

                if (!eventMapping.FormatSlugs.Contains(TournamentFormat.LegacySlug, StringComparer.Ordinal))
                {
                    eventErrors.Add(new MigrationReportIssue("formatMappingRequiresLegacy", $"calendar event '{entity.Id}': V1 Scheduled Tournaments require the '{TournamentFormat.LegacySlug}' format to be explicitly mapped"));
                }
            }

            if (eventMapping.Status is null)
            {
                eventErrors.Add(new MigrationReportIssue("missingStatusPolicy", $"calendar event '{entity.Id}': status policy must be one of {string.Join("/", MigrationMappingReader.StatusPolicies)}"));
            }
            else if (!MigrationMappingReader.StatusPolicies.Contains(eventMapping.Status, StringComparer.Ordinal))
            {
                eventErrors.Add(new MigrationReportIssue("unknownStatusPolicy", $"calendar event '{entity.Id}': status policy '{eventMapping.Status}' is not one of {string.Join("/", MigrationMappingReader.StatusPolicies)}"));
            }

            if (eventMapping.Capacity is <= 0)
            {
                eventErrors.Add(new MigrationReportIssue("invalidCapacity", $"calendar event '{entity.Id}': capacity must be positive when present"));
            }

            var summary = SanitizeDescription(entity.Id, source, sanitation);
            var bodyMarkdown = SanitizeBodyMarkdown(entity.Id, source, sanitation);

            if (eventDate is not null && startTime is not null && zone is not null)
            {
                var startLocal = eventDate.Value.At(startTime.Value);
                var mappedZone = zone.MapLocal(startLocal);
                if (mappedZone.Count == 0)
                {
                    eventErrors.Add(new MigrationReportIssue("startTimeInDstGap", $"calendar event '{entity.Id}': start time falls in a daylight-saving gap in {zone.Id}"));
                }
            }

            if (eventErrors.Count > 0)
            {
                errors.AddRange(eventErrors);
                continue;
            }

            var draft = new ScheduledTournamentDraft(
                title,
                slug,
                summary,
                bodyMarkdown,
                address!,
                FirstNonEmpty(eventMapping.PostalCode),
                city!,
                country!,
                zone!.Id,
                eventDate!.Value.At(startTime!.Value),
                endTime is null ? null : eventDate.Value.At(endTime.Value),
                eventMapping.Capacity);
            planned.Add(new PlannedScheduledTournament(entity.Id, draft, eventMapping.FormatSlugs!, eventMapping.Status!));
            summaries.Add(new MigrationCalendarMappingSummary(
                entity.Id, title, slug, draft.StartsAtLocal.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture),
                zone.Id, city!, country!, eventMapping.FormatSlugs!, eventMapping.Status!));
        }

        return (planned, summaries);
    }

    private static string? SanitizeDescription(string eventId, LegacyCalendarEvent source, List<MigrationSanitationChange> sanitation)
    {
        var summary = source.Description.Trim();
        if (summary.Length == 0) return null;
        if (summary.Length > Event.MaximumSummaryLength)
        {
            sanitation.Add(new MigrationSanitationChange(eventId, "truncatedSummary", $"description shortened from {summary.Length} to {Event.MaximumSummaryLength} characters"));
            summary = summary[..Event.MaximumSummaryLength].Trim();
        }

        return summary.Length == 0 ? null : summary;
    }

    private static string? SanitizeBodyMarkdown(string eventId, LegacyCalendarEvent source, List<MigrationSanitationChange> sanitation)
    {
        var html = source.RichDescriptionHtml.Trim();
        if (ImageTagRegex().IsMatch(html))
        {
            sanitation.Add(new MigrationSanitationChange(eventId, "removedImage", "embedded <img> markup is not allowed in Event Markdown and was removed"));
        }

        string? body = null;
        if (html.Length > 0)
        {
            var text = WebUtility.HtmlDecode(WhitespaceRegex().Replace(HtmlTagRegex().Replace(html, " "), " ")).Trim();
            if (text.Length > Event.MaximumBodyMarkdownLength) text = text[..Event.MaximumBodyMarkdownLength];
            sanitation.Add(new MigrationSanitationChange(eventId, "strippedUnsafeHtml", "legacy rich description markup was removed; only its readable text was kept as Markdown"));
            body = text.Length == 0 ? null : text;
        }

        var externalLink = source.ExternalLink.Trim();
        if (externalLink.Length > 0)
        {
            if (Uri.TryCreate(externalLink, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && !string.IsNullOrWhiteSpace(uri.Host))
            {
                var linkMarkdown = $"<{uri.AbsoluteUri}>";
                var separatorLength = body is null ? 0 : 2;
                if ((body?.Length ?? 0) + separatorLength + linkMarkdown.Length <= Event.MaximumBodyMarkdownLength)
                {
                    body = body is null ? linkMarkdown : body + "\n\n" + linkMarkdown;
                    sanitation.Add(new MigrationSanitationChange(eventId, "convertedExternalLink", $"externalLink converted to a Markdown link: {uri.AbsoluteUri}"));
                }
                else
                {
                    sanitation.Add(new MigrationSanitationChange(eventId, "droppedExternalLink", "externalLink dropped: body has no room for the converted link"));
                }
            }
            else
            {
                sanitation.Add(new MigrationSanitationChange(eventId, "droppedExternalLink", $"externalLink dropped: '{externalLink}' is not an absolute HTTPS URL"));
            }
        }

        return body;
    }

    private static (List<string> ToAdd, int AlreadyPresent) PlanDeckArchetypes(
        IReadOnlyList<MigrationBundleFile> bundles,
        MigrationTargetState target)
    {
        var toAdd = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var alreadyPresent = 0;
        foreach (var name in bundles.SelectMany(bundle => bundle.DeckArchetypes))
        {
            var trimmed = WhitespaceRegex().Replace(name.Trim(), " ");
            if (trimmed.Length == 0 || trimmed.Length > DeckArchetype.MaximumNameLength) continue;
            var key = DeckArchetype.NormalizeKey(trimmed);
            if (!seen.Add(key)) continue;
            if (target.ExistingDeckArchetypeKeys.Contains(key)) alreadyPresent++;
            else toAdd.Add(trimmed);
        }

        return (toAdd, alreadyPresent);
    }

    private static string ComputeBatchHash(IReadOnlyList<MigrationBundleFile> bundles, MigrationManifestFile manifest, MigrationMappingFile mapping)
    {
        var payload = LeagueJson.Serialize(new
        {
            bundleChecksums = bundles.Select(bundle => bundle.BundleChecksum).OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            manifestHash = manifest.ManifestHash,
            mappingHash = mapping.MappingHash
        });
        using var document = JsonDocument.Parse(payload);
        return CanonicalJson.Checksum(document.RootElement);
    }

    private static MigrationReport BuildReport(
        IReadOnlyList<MigrationBundleFile> bundles,
        MigrationManifestFile manifest,
        MigrationMappingFile mapping,
        MigrationTargetState target,
        string mode,
        string generatedAt,
        string batchHash,
        List<LeagueDocument> leaguesToCreate,
        List<TournamentDocument> standaloneTournaments,
        List<PlannedScheduledTournament> scheduled,
        List<LiveTournamentDocument> liveToCreate,
        List<string> archetypesToAdd,
        int archetypesPresent,
        int skippedEntities,
        List<MigrationCalendarMappingSummary> mappingSummaries,
        List<string> deduplicates,
        List<MigrationReportIssue> conflicts,
        List<string> collisions,
        List<MigrationSanitationChange> sanitation,
        List<MigrationReportIssue> warnings,
        List<MigrationReportIssue> errors)
    {
        var leagueHashes = leaguesToCreate.ToDictionary(
            league => league.Id,
            CanonicalLeagueHash,
            StringComparer.Ordinal);
        var liveHashes = liveToCreate.ToDictionary(
            live => live.Id,
            live => DocumentHash(LeagueJson.Serialize(live)),
            StringComparer.Ordinal);

        var report = new MigrationReport(
            MigrationReport.ReportKind,
            MigrationReport.FormatVersion,
            mode,
            generatedAt,
            target.DatabaseIdentity,
            bundles.Select(bundle => new MigrationReportBundle(
                bundle.FileName,
                bundle.SourceInstanceId,
                bundle.BundleChecksum,
                manifest.SourceInstances.FirstOrDefault(instance => instance.SourceInstanceId == bundle.SourceInstanceId)?.Role ?? "unknown",
                bundle.Counts,
                bundle.StoreErrors)).ToArray(),
            manifest.ManifestHash,
            mapping.MappingHash,
            batchHash,
            new MigrationReportCounts(
                bundles.Sum(bundle => bundle.Counts.Leagues),
                bundles.Sum(bundle => bundle.Counts.Tournaments),
                bundles.Sum(bundle => bundle.Counts.CalendarEvents),
                bundles.Sum(bundle => bundle.Counts.LiveTournaments),
                bundles.Sum(bundle => bundle.Counts.DeckArchetypes)),
            new MigrationPlannedCounts(
                leaguesToCreate.Count,
                leaguesToCreate.Sum(league => league.Tournaments.Count) + standaloneTournaments.Count,
                standaloneTournaments.Count,
                scheduled.Count,
                liveToCreate.Count,
                archetypesToAdd.Count,
                archetypesPresent,
                skippedEntities),
            mapping.OrganizationId.ToString("D"),
            mapping.OwnerUserId.ToString("D"),
            mappingSummaries,
            deduplicates,
            conflicts,
            collisions,
            sanitation,
            new MigrationEntityHashes(leagueHashes, liveHashes),
            warnings,
            errors,
            string.Empty);
        return report.WithComputedHash();
    }

    /// <summary>
    /// Canonical League hash ordering rule (frozen): before serializing a LeagueDocument for
    /// hashing, its Tournaments list is sorted ascending by Tournament Id with
    /// StringComparer.Ordinal; every other field and all nested content are untouched. Both the
    /// planner (expected hash) and the import verifier (stored hash) must obtain League hashes
    /// through this method, so tournament order in the source bundle can never affect the hash.
    /// </summary>
    public static string CanonicalLeagueHash(LeagueDocument league) =>
        DocumentHash(LeagueJson.Serialize(
            league with { Tournaments = [.. league.Tournaments.OrderBy(tournament => tournament.Id, StringComparer.Ordinal)] }));

    public static string DocumentHash(string serializedDocument)
    {
        using var document = JsonDocument.Parse(serializedDocument);
        return $"sha256:{CanonicalJson.Sha256Hex(CanonicalJson.Stringify(document.RootElement))}";
    }

    private static MigrationReportIssue Missing(string eventId, string field) =>
        new("missingMappingField", $"calendar event '{eventId}': {field} is required from the source event or the mapping entry");

    private static string? FirstNonEmpty(params string?[] values)
    {
        foreach (var value in values)
        {
            var trimmed = value?.Trim();
            if (!string.IsNullOrEmpty(trimmed)) return trimmed;
        }

        return null;
    }

    private static LocalTime? ParseTime(string? value)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        foreach (var format in (string[])["HH:mm", "H:mm", "HH:mm:ss"])
        {
            if (DateTime.TryParseExact(trimmed, format, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            {
                return new LocalTime(parsed.Hour, parsed.Minute, parsed.Second);
            }
        }

        return null;
    }

    private static string LenientSlug(string rawSlug, string fallbackTitle)
    {
        foreach (var candidate in (string[])[rawSlug, fallbackTitle])
        {
            var slug = Slugify(candidate);
            if (slug.Length > 0) return slug;
        }

        return string.Empty;
    }

    private static string Slugify(string value)
    {
        var builder = new System.Text.StringBuilder();
        var previousHyphen = true;
        foreach (var character in value.Trim().ToLowerInvariant())
        {
            if (char.IsAsciiLetterOrDigit(character))
            {
                builder.Append(character);
                previousHyphen = false;
            }
            else if (!previousHyphen)
            {
                builder.Append('-');
                previousHyphen = true;
            }
        }

        var slug = builder.ToString().Trim('-');
        return slug.Length > Event.MaximumSlugLength ? slug[..Event.MaximumSlugLength].Trim('-') : slug;
    }

    private sealed record LegacyCalendarEvent(
        string Title,
        string Slug,
        string EventDate,
        string StartTime,
        string EndTime,
        string Location,
        string Country,
        string City,
        string Address,
        string Description,
        string RichDescriptionHtml,
        string ExternalLink)
    {
        public static LegacyCalendarEvent From(JsonElement element) => new(
            Text(element, "title"),
            Text(element, "slug"),
            Text(element, "eventDate"),
            Text(element, "startTime"),
            Text(element, "endTime"),
            Text(element, "location"),
            Text(element, "country"),
            Text(element, "city"),
            Text(element, "address"),
            Text(element, "description"),
            Text(element, "richDescriptionHtml"),
            Text(element, "externalLink"));

        private static string Text(JsonElement element, string name) =>
            element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString()! : string.Empty;
    }
}
