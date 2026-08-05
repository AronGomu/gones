using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Domain.Catalog;
using Gones.Domain.Identity;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using NodaTime.Text;

namespace Gones.Api.Admin;

internal static class AdminEndpoints
{
    public const int DefaultPageSize = 20;
    public const int MaximumPageSize = 100;

    public static void MapAdminEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin").RequireAuthorization(AuthorizationPolicies.Admin);

        admin.MapGet("/users", ListUsersAsync)
            .Produces<AdminUserListResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest);

        admin.MapGet("/users/{userId:guid}", GetUserAsync)
            .Produces<AdminUserDetailResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        admin.MapGet("/users/{userId:guid}/closure-impact", GetClosureImpactAsync)
            .Produces<AdminAccountClosureImpactResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        admin.MapPost("/users/{userId:guid}/disable", DisableUserAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/users/{userId:guid}/roles/{role}/grant", GrantRoleAsync)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/users/{userId:guid}/roles/{role}/revoke", RevokeRoleAsync)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapGet("/audit", ListAuditAsync)
            .Produces<AdminAuditListResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest);

        admin.MapGet("/formats", ListAdminFormatsAsync).Produces<IReadOnlyList<AdminFormatResponse>>();
        admin.MapPost("/formats", CreateFormatAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<AdminFormatResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        admin.MapPut("/formats/{formatId:guid}", UpdateFormatAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<AdminFormatResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        admin.MapDelete("/formats/{formatId:guid}", DeleteFormatAsync)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapGet("/deck-archetypes", ListAdminDeckArchetypesAsync)
            .WithName("ListAdminDeckArchetypes")
            .Produces<IReadOnlyList<AdminDeckArchetypeResponse>>();
        admin.MapPost("/deck-archetypes", CreateDeckArchetypeAsync)
            .WithName("CreateDeckArchetype")
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<AdminDeckArchetypeResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        admin.MapPut("/deck-archetypes/{archetypeId:guid}", RenameDeckArchetypeAsync)
            .WithName("RenameDeckArchetype")
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<AdminDeckArchetypeResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        admin.MapDelete("/deck-archetypes/{archetypeId:guid}", DeleteDeckArchetypeAsync)
            .WithName("DeleteDeckArchetype")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);
        admin.MapPost("/deck-archetypes/{archetypeId:guid}/restore", RestoreDeckArchetypeAsync)
            .WithName("RestoreDeckArchetype")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);
        admin.MapPost("/deck-archetypes/import", ImportDeckArchetypesAsync)
            .WithName("ImportDeckArchetypes")
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<DeckArchetypeImportResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
    }

    public static void MapPublicCatalogEndpoints(this WebApplication app)
    {
        app.MapGet("/api/formats", ListPublicFormatsAsync)
            .AllowAnonymous()
            .Produces<IReadOnlyList<PublicFormatResponse>>();

        app.MapGet("/api/deck-archetypes", ListPublicDeckArchetypesAsync)
            .WithName("ListDeckArchetypes")
            .AllowAnonymous()
            .Produces<IReadOnlyList<PublicDeckArchetypeResponse>>();
    }

    private static async Task<IResult> ListUsersAsync(
        string? search,
        int? page,
        int? pageSize,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaximumPageSize);
        var query = from user in database.Users.AsNoTracking()
                    join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
                    select new { user, profile };

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var normalized = term.ToUpperInvariant();
            query = query.Where(item =>
                item.profile.Username.Contains(term)
                || item.profile.NormalizedUsername.Contains(normalized)
                || (item.user.Email != null && item.user.Email.Contains(term))
                || (item.user.NormalizedEmail != null && item.user.NormalizedEmail.Contains(normalized)));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(item => item.profile.NormalizedUsername)
            .ThenBy(item => item.user.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(item => new AdminUserSummaryResponse(
                item.user.Id,
                item.user.Email ?? string.Empty,
                item.user.EmailConfirmed,
                item.user.GlobalRole,
                item.profile.Username,
                item.profile.FirstName,
                item.profile.LastName,
                item.profile.ClosedAt != null,
                item.profile.CreatedAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new AdminUserListResponse(items, pageNumber, size, total));
    }

    private static async Task<IResult> GetUserAsync(
        Guid userId,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var item = await (
            from user in database.Users.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
            where user.Id == userId
            select new AdminUserDetailResponse(
                user.Id,
                user.Email ?? string.Empty,
                user.EmailConfirmed,
                user.GlobalRole,
                profile.Username,
                profile.FirstName,
                profile.LastName,
                profile.ClosedAt != null,
                profile.ClosedAt,
                profile.CreatedAt,
                profile.UpdatedAt)
        ).SingleOrDefaultAsync(cancellationToken) ?? throw new ResourceNotFoundException();
        return Results.Ok(item);
    }

    private static async Task<IResult> GetClosureImpactAsync(
        Guid userId,
        ClaimsPrincipal principal,
        AdminAccountService accounts,
        CancellationToken cancellationToken)
    {
        var impact = await accounts.GetClosureImpactAsync(CurrentUserId(principal), userId, cancellationToken);
        return Results.Ok(ToClosureImpact(impact));
    }

    private static async Task<IResult> DisableUserAsync(
        Guid userId,
        DisableUserRequest request,
        ClaimsPrincipal principal,
        AdminAccountService accounts,
        CancellationToken cancellationToken)
    {
        var transfers = (request.OwnershipTransfers ?? [])
            .Select(item => new OwnershipTransferRequest(item.OrganizationId, item.NewOwnerUserId))
            .ToArray();
        await accounts.CloseAsync(CurrentUserId(principal), userId, request.ConfirmedUsername, transfers, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ListAuditAsync(
        string? action,
        string? entityType,
        string? entityId,
        Guid? actorId,
        string? from,
        string? to,
        int? page,
        int? pageSize,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaximumPageSize);
        var fromInstant = ParseInstantQuery(from, nameof(from));
        var toInstant = ParseInstantQuery(to, nameof(to));
        var query = database.AuditRecords.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(action))
        {
            var term = action.Trim();
            query = query.Where(item => item.Action.Contains(term));
        }

        if (!string.IsNullOrWhiteSpace(entityType))
        {
            var term = entityType.Trim();
            query = query.Where(item => item.EntityType == term);
        }

        if (!string.IsNullOrWhiteSpace(entityId))
        {
            var term = entityId.Trim();
            query = query.Where(item => item.EntityId == term);
        }

        if (actorId is not null)
        {
            query = query.Where(item => item.ActorId == actorId);
        }

        if (fromInstant is not null)
        {
            query = query.Where(item => item.OccurredAt >= fromInstant);
        }

        if (toInstant is not null)
        {
            query = query.Where(item => item.OccurredAt <= toInstant);
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderByDescending(item => item.OccurredAt)
            .ThenByDescending(item => item.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(item => new AdminAuditRecordResponse(
                item.Id,
                item.ActorId,
                item.Action,
                item.EntityType,
                item.EntityId,
                item.RedactedDiff,
                item.OccurredAt))
            .ToListAsync(cancellationToken);

        return Results.Ok(new AdminAuditListResponse(items, pageNumber, size, total));
    }

    private static async Task<IResult> GrantRoleAsync(
        Guid userId,
        string role,
        ClaimsPrincipal principal,
        AdminRoleService roles,
        CancellationToken cancellationToken)
    {
        if (!GlobalRoles.IsAssignable(role)) throw Validation("role", "Role must be Organizer or Admin.");
        await roles.ChangeRoleAsync(CurrentUserId(principal), userId, role, GlobalRoleChangeKind.Grant, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> RevokeRoleAsync(
        Guid userId,
        string role,
        ClaimsPrincipal principal,
        AdminRoleService roles,
        CancellationToken cancellationToken)
    {
        if (!GlobalRoles.IsAssignable(role)) throw Validation("role", "Role must be Organizer or Admin.");
        await roles.ChangeRoleAsync(CurrentUserId(principal), userId, role, GlobalRoleChangeKind.Revoke, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ListAdminFormatsAsync(GonesDbContext database, CancellationToken cancellationToken)
    {
        var formats = await database.TournamentFormats.AsNoTracking()
            .OrderBy(format => format.SortOrder)
            .ThenBy(format => format.Name)
            .ToListAsync(cancellationToken);
        return Results.Ok(formats.Select(ToAdminFormat).ToArray());
    }

    private static async Task<IResult> CreateFormatAsync(
        UpsertFormatRequest request,
        ClaimsPrincipal principal,
        AdminCatalogService catalog,
        CancellationToken cancellationToken)
    {
        var format = await catalog.CreateAsync(CurrentUserId(principal), request.Name, request.Slug, request.SortOrder, cancellationToken);
        return Results.Created($"/api/admin/formats/{format.Id:D}", ToAdminFormat(format));
    }

    private static async Task<IResult> UpdateFormatAsync(
        Guid formatId,
        UpsertFormatRequest request,
        ClaimsPrincipal principal,
        AdminCatalogService catalog,
        CancellationToken cancellationToken)
    {
        var format = await catalog.UpdateAsync(CurrentUserId(principal), formatId, request.Name, request.Slug, request.SortOrder, cancellationToken);
        return Results.Ok(ToAdminFormat(format));
    }

    private static async Task<IResult> DeleteFormatAsync(
        Guid formatId,
        ClaimsPrincipal principal,
        AdminCatalogService catalog,
        CancellationToken cancellationToken)
    {
        await catalog.SoftDeleteAsync(CurrentUserId(principal), formatId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ListPublicFormatsAsync(GonesDbContext database, CancellationToken cancellationToken)
    {
        var formats = await database.TournamentFormats.AsNoTracking()
            .Where(format => format.DeletedAt == null)
            .OrderBy(format => format.SortOrder)
            .ThenBy(format => format.Name)
            .Select(format => new PublicFormatResponse(format.Id, format.Name, format.Slug, format.SortOrder))
            .ToListAsync(cancellationToken);
        return Results.Ok(formats);
    }

    private static async Task<IResult> ListAdminDeckArchetypesAsync(GonesDbContext database, CancellationToken cancellationToken)
    {
        var archetypes = await database.DeckArchetypes.AsNoTracking()
            .OrderBy(archetype => archetype.Name)
            .ToListAsync(cancellationToken);
        return Results.Ok(archetypes.Select(ToAdminDeckArchetype).ToArray());
    }

    private static async Task<IResult> CreateDeckArchetypeAsync(
        UpsertDeckArchetypeRequest request,
        ClaimsPrincipal principal,
        AdminCatalogService catalog,
        CancellationToken cancellationToken)
    {
        var archetype = await catalog.CreateArchetypeAsync(CurrentUserId(principal), request.Name, cancellationToken);
        return Results.Created($"/api/admin/deck-archetypes/{archetype.Id:D}", ToAdminDeckArchetype(archetype));
    }

    private static async Task<IResult> RenameDeckArchetypeAsync(
        Guid archetypeId,
        UpsertDeckArchetypeRequest request,
        ClaimsPrincipal principal,
        AdminCatalogService catalog,
        CancellationToken cancellationToken)
    {
        var archetype = await catalog.RenameArchetypeAsync(CurrentUserId(principal), archetypeId, request.Name, cancellationToken);
        return Results.Ok(ToAdminDeckArchetype(archetype));
    }

    private static async Task<IResult> DeleteDeckArchetypeAsync(
        Guid archetypeId,
        ClaimsPrincipal principal,
        AdminCatalogService catalog,
        CancellationToken cancellationToken)
    {
        await catalog.SoftDeleteArchetypeAsync(CurrentUserId(principal), archetypeId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> RestoreDeckArchetypeAsync(
        Guid archetypeId,
        ClaimsPrincipal principal,
        AdminCatalogService catalog,
        CancellationToken cancellationToken)
    {
        await catalog.RestoreArchetypeAsync(CurrentUserId(principal), archetypeId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ImportDeckArchetypesAsync(
        ImportDeckArchetypesRequest request,
        ClaimsPrincipal principal,
        AdminCatalogService catalog,
        CancellationToken cancellationToken)
    {
        if (request.Names is null || request.Names.Count == 0) throw Validation("names", "At least one Deck Archetype name is required.");
        if (request.Names.Count > 1000) throw Validation("names", "Import supports at most 1000 Deck Archetype names.");
        var result = await catalog.ImportArchetypesAsync(CurrentUserId(principal), request.Names, cancellationToken);
        return Results.Ok(new DeckArchetypeImportResponse(result.Added, result.Restored, result.Skipped, result.Total));
    }

    private static async Task<IResult> ListPublicDeckArchetypesAsync(GonesDbContext database, CancellationToken cancellationToken)
    {
        var archetypes = await database.DeckArchetypes.AsNoTracking()
            .Where(archetype => archetype.DeletedAt == null)
            .OrderBy(archetype => archetype.Name)
            .Select(archetype => new PublicDeckArchetypeResponse(archetype.Id, archetype.Name))
            .ToListAsync(cancellationToken);
        return Results.Ok(archetypes);
    }

    private static AdminDeckArchetypeResponse ToAdminDeckArchetype(DeckArchetype archetype) =>
        new(archetype.Id, archetype.Name, archetype.DeletedAt, archetype.CreatedAt, archetype.UpdatedAt);

    private static AdminFormatResponse ToAdminFormat(TournamentFormat format) =>
        new(format.Id, format.Name, format.Slug, format.SortOrder, format.DeletedAt, format.CreatedAt, format.UpdatedAt);

    private static AdminAccountClosureImpactResponse ToClosureImpact(AccountClosureImpact impact) =>
        new(
            impact.UserId,
            impact.Username,
            impact.Email,
            impact.GlobalRole,
            impact.IsClosed,
            impact.IsLastAdmin,
            impact.IsSelf,
            impact.CanClose,
            impact.BlockReason,
            impact.SoleOwnedOrganizations.Select(item => new AdminSoleOwnerOrganizationResponse(
                item.OrganizationId,
                item.OrganizationName,
                item.SuggestedNewOwnerUserId,
                item.SuggestedNewOwnerUsername)).ToArray(),
            impact.OtherMembershipOrganizationIds);

    private static Guid CurrentUserId(ClaimsPrincipal principal)
    {
        var value = principal.FindFirstValue("sub") ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(value, out var userId) ? userId : throw new AuthenticationFailedException();
    }

    private static Instant? ParseInstantQuery(string? value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (InstantPattern.ExtendedIso.Parse(value.Trim()).TryGetValue(default, out var instant)) return instant;
        if (DateTimeOffset.TryParse(value, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out var dto))
        {
            return Instant.FromDateTimeOffset(dto);
        }

        throw Validation(field, "Value must be an ISO-8601 instant.");
    }

    private static ApiValidationException Validation(string field, string message) =>
        new(new Dictionary<string, string[]> { [field] = [message] });
}

internal sealed record AdminUserListResponse(
    IReadOnlyList<AdminUserSummaryResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record AdminUserSummaryResponse(
    Guid Id,
    string Email,
    bool EmailVerified,
    string GlobalRole,
    string Username,
    string FirstName,
    string LastName,
    bool IsClosed,
    Instant CreatedAt);

internal sealed record AdminUserDetailResponse(
    Guid Id,
    string Email,
    bool EmailVerified,
    string GlobalRole,
    string Username,
    string FirstName,
    string LastName,
    bool IsClosed,
    Instant? ClosedAt,
    Instant CreatedAt,
    Instant UpdatedAt);

internal sealed record AdminAccountClosureImpactResponse(
    Guid UserId,
    string Username,
    string Email,
    string GlobalRole,
    bool IsClosed,
    bool IsLastAdmin,
    bool IsSelf,
    bool CanClose,
    string? BlockReason,
    IReadOnlyList<AdminSoleOwnerOrganizationResponse> SoleOwnedOrganizations,
    IReadOnlyList<Guid> OtherMembershipOrganizationIds);

internal sealed record AdminSoleOwnerOrganizationResponse(
    Guid OrganizationId,
    string OrganizationName,
    Guid? SuggestedNewOwnerUserId,
    string? SuggestedNewOwnerUsername);

internal sealed record DisableUserRequest(
    [property: Required, StringLength(120)] string ConfirmedUsername,
    IReadOnlyList<OwnershipTransferBody>? OwnershipTransfers);

internal sealed record OwnershipTransferBody(
    [property: Required] Guid OrganizationId,
    [property: Required] Guid NewOwnerUserId);

internal sealed record AdminAuditListResponse(
    IReadOnlyList<AdminAuditRecordResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record AdminAuditRecordResponse(
    Guid Id,
    Guid? ActorId,
    string Action,
    string EntityType,
    string EntityId,
    string RedactedDiff,
    Instant OccurredAt);

internal sealed record UpsertFormatRequest(
    [property: Required, StringLength(TournamentFormat.MaximumNameLength)] string Name,
    [property: Required, StringLength(TournamentFormat.MaximumSlugLength)] string Slug,
    [property: Range(0, int.MaxValue)] int SortOrder);

internal sealed record AdminFormatResponse(
    Guid Id,
    string Name,
    string Slug,
    int SortOrder,
    Instant? DeletedAt,
    Instant CreatedAt,
    Instant UpdatedAt);

internal sealed record PublicFormatResponse(
    Guid Id,
    string Name,
    string Slug,
    int SortOrder);

internal sealed record UpsertDeckArchetypeRequest(
    [property: Required, StringLength(DeckArchetype.MaximumNameLength)] string Name);

internal sealed record ImportDeckArchetypesRequest(
    [property: Required] IReadOnlyList<string> Names);

internal sealed record AdminDeckArchetypeResponse(
    Guid Id,
    string Name,
    Instant? DeletedAt,
    Instant CreatedAt,
    Instant UpdatedAt);

internal sealed record DeckArchetypeImportResponse(
    int Added,
    int Restored,
    int Skipped,
    int Total);

internal sealed record PublicDeckArchetypeResponse(
    Guid Id,
    string Name);
