# T5: Profile schema — birth date + structured location

**Plan:** `./ai-artifacts/PLAN_2026_08_08_feedback-calendar-v1.md`
**Depends:** T1
**Commit outcome:** The user profile stores a full `birth_date` and a three-part location (`country`/`region`/`city`) end to end, with the generated TypeScript client regenerated and the existing UI still compiling.

## Context (self-contained)

- Goal: land the whole `feedback.md` list on Gones Calendar V1. This ticket is the server half of Profile §2 ("Lieu" split into Country / Region / City) and Profile §3 ("Année de naissance" becomes a date input).
- This slice: domain, EF migration, API contracts, generated client. The UI keeps working against the new shape with plain inputs; the geo selects arrive in T10 and the merged page in T8/T9.
- Out of scope here: geo datasets, `<select>` markup, dirty-tracking, the settings merge, account deletion.
- Assumptions in force:
  - **A5** — `location` is replaced by `location_country` / `location_region` / `location_city`; the old value backfills into `location_city`. One privacy toggle (`IsLocationPublic`) still governs all three.
  - **A6** — `birth_year int` → `birth_date date`, backfilled to `YYYY-01-01`; `IsBirthYearPublic` → `IsBirthDatePublic`; public participant views expose the **year only**, computed from `birth_date`.

## Requirements

- `UserProfile` exposes `LocalDate? BirthDate`, `string? LocationCountry`, `string? LocationRegion`, `string? LocationCity`, `bool IsBirthDatePublic`; `BirthYear`, `Location` and `IsBirthYearPublic` are gone.
- One EF migration renames/creates the columns and backfills existing rows without data loss.
- `PATCH /api/users/me` accepts `birthDate` (ISO `yyyy-MM-dd`), `locationCountry`, `locationRegion`, `locationCity`, `isLocationPublic`, `isBirthDatePublic`.
- `GET /api/users/me` returns the same shape.
- Public participant projections keep exposing only a birth **year** and only when `IsBirthDatePublic`.
- `src/app/api/generated/gones-api.ts` is regenerated; `src/app/auth/profile.component.ts` compiles against the new fields.

## Inputs

- `backend/src/Gones.Domain/Identity/UserProfile.cs` — `public sealed class UserProfile : VersionedEntity` with `public string? Location { get; private set; }`, `public int? BirthYear { get; private set; }`, `public bool IsLocationPublic`, `public bool IsBirthYearPublic`, and `public void Update(string username, string firstName, string lastName, string? location, int? birthYear, string preferredLanguage, bool isFirstNamePublic, bool isLastNamePublic, bool isLocationPublic, bool isBirthYearPublic, bool isPreferredLanguagePublic, int currentYear, Instant now)` which currently validates `birthYear is < 1900 || birthYear > currentYear`.
- `backend/src/Gones.Infrastructure/Persistence/IdentityRecordConfigurations.cs:128` — `builder.Property(profile => profile.Location).HasMaxLength(200);`
- `backend/src/Gones.Infrastructure/Persistence/SnakeCaseModelBuilderExtensions.cs` — column names are snake_cased automatically, so `LocationCountry` → `location_country`.
- `backend/src/Gones.Infrastructure/Persistence/Migrations/` — latest migration is `20260805105726_AddDeckArchetypeCatalog`; `GonesDbContextModelSnapshot.cs` sits alongside.
- `backend/src/Gones.Infrastructure/Persistence/GonesDbContextFactory.cs` — design-time factory, so `dotnet ef` works without a running API.
- `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`:
  - `:286-299` `profile.Update(request.Username, request.FirstName, request.LastName, request.Location, request.BirthYear, …, clock.GetCurrentInstant().InUtc().Year, clock.GetCurrentInstant());`
  - `:333-353` `ChangedFields(...)` with `Add(nameof(request.Location), …)` and `Add(nameof(request.BirthYear), …)`
  - `:361-378` `ToResponse(user, profile)` positional record construction
  - `:433-445` `internal sealed record PatchUserProfileRequest(... [property: StringLength(200)] string? Location, int? BirthYear, ...)`
  - `:447-464` `internal sealed record UserProfileResponse(... string? Location, int? BirthYear, ...)`
- `backend/src/Gones.Api/Tournaments/PublicTournamentEndpoints.cs:183-184` — `profile.IsLocationPublic ? profile.Location : null, profile.IsBirthYearPublic ? profile.BirthYear : null,` feeding the record at `:479-480` (`string? Location, int? BirthYear`).
- `src/app/auth/profile.component.ts:92-98` — `location = this.profile()?.location ?? ''; birthYear: number | undefined = this.profile()?.birthYear; … isBirthYearPublic = this.profile()?.isBirthYearPublic ?? false;` and `:111` passes them to `auth.updateProfile({...})`.
- `src/app/auth/auth.service.ts:105-109` — `updateProfile(request: PatchUserProfileRequest)` calls `this.client.mePATCH(request)`.
- Regeneration: `npm run api:generate` boots the API against Postgres. Start the database first (`npm run dev` in another shell, or `docker compose up -d postgres`). `npm run api:check` verifies the committed client matches.
- NodaTime is already the date/time stack (`using NodaTime;` in the domain); the API serialises with `NodaTime.Serialization.SystemTextJson`.
- **From Depends (T1):** nothing consumed on the backend; `src/app/shared/data-cy-coverage.test.ts` allowlist untouched by this ticket.

## TDD

1. **Red** — add `backend/tests/Gones.UnitTests/UserProfileBirthDateTests.cs` and extend `backend/tests/Gones.IntegrationTests/LocalIdentityApiTests.cs` with the profile round-trip rows below. They fail to compile against today's domain, which is the red state.
2. **Green** — change the domain, EF configuration, migration, endpoints and records until both suites pass.
3. **Refactor** — keep `ChangedFields` exhaustive; add the three location fields and `birthDate` so the audit diff still names every changed field.

## Test plan

| Test | Input | Expect |
| --- | --- | --- |
| `Update_accepts_a_past_birth_date` | `BirthDate = 1990-04-17`, `today = 2026-08-08` | no throw, `profile.BirthDate` is `1990-04-17` |
| `Update_rejects_a_future_birth_date` | `BirthDate = 2027-01-01`, `today = 2026-08-08` | `ArgumentOutOfRangeException` naming `birthDate` |
| `Update_rejects_a_birth_date_before_1900` | `BirthDate = 1899-12-31` | `ArgumentOutOfRangeException` naming `birthDate` |
| `Update_stores_the_three_location_parts` | `country="FR"`, `region="69"`, `city="Lyon"` | all three round-trip; `Location` no longer exists |
| `Patch_me_round_trips_the_new_shape` | `PATCH /api/users/me` with `birthDate`, `locationCountry/Region/City` | 200; a following `GET /api/users/me` returns identical values |
| `Public_participant_exposes_year_only` | profile with `BirthDate=1990-04-17`, `IsBirthDatePublic=true` | participant response `birthYear == 1990`, no full date field |
| `Public_participant_hides_a_private_birth_date` | same with `IsBirthDatePublic=false` | `birthYear == null` |
| `Migration_backfills` | row with `birth_year=1990`, `location='Lyon'` before migrating | after: `birth_date='1990-01-01'`, `location_city='Lyon'`, `location_country IS NULL` |

Run: `npm run backend:test`

## Impl steps

- [ ] 1. Ensure the EF CLI exists: `dotnet ef --version`; if missing run `dotnet tool install --global dotnet-ef`.
- [ ] 2. In `backend/src/Gones.Domain/Identity/UserProfile.cs`, replace `public string? Location { get; private set; }` with three properties `LocationCountry`, `LocationRegion`, `LocationCity`, all `string?` with `private set`.
- [ ] 3. Replace `public int? BirthYear { get; private set; }` with `public LocalDate? BirthDate { get; private set; }` and `public bool IsBirthYearPublic` with `public bool IsBirthDatePublic`.
- [ ] 4. Change the `Update(...)` signature to `Update(string username, string firstName, string lastName, string? locationCountry, string? locationRegion, string? locationCity, LocalDate? birthDate, string preferredLanguage, bool isFirstNamePublic, bool isLastNamePublic, bool isLocationPublic, bool isBirthDatePublic, bool isPreferredLanguagePublic, LocalDate today, Instant now)`.
- [ ] 5. Replace the birth-year range check with: `if (birthDate is { } value && (value.Year < 1900 || value > today)) throw new ArgumentOutOfRangeException(nameof(birthDate), $"Birth date must be between 1900-01-01 and {today:yyyy-MM-dd}.");`
- [ ] 6. Trim and null-empty the three location strings; cap each at 100 characters and throw `ArgumentException` naming the offending parameter beyond that.
- [ ] 7. In `backend/src/Gones.Infrastructure/Persistence/IdentityRecordConfigurations.cs`, replace line 128 with three `HasMaxLength(100)` property configurations for `LocationCountry`, `LocationRegion`, `LocationCity`.
- [ ] 8. Run `dotnet ef migrations add SplitProfileLocationAndBirthDate --project backend/src/Gones.Infrastructure --startup-project backend/src/Gones.Api --output-dir Persistence/Migrations`.
- [ ] 9. Hand-edit the generated `Up(...)`: use `RenameColumn` `location` → `location_city` and `is_birth_year_public` → `is_birth_date_public`; `AddColumn<string>` for `location_country` and `location_region` (`maxLength: 100, nullable: true`); `AddColumn<DateOnly>("birth_date", nullable: true)`; then `migrationBuilder.Sql("UPDATE user_profiles SET birth_date = make_date(birth_year, 1, 1) WHERE birth_year IS NOT NULL;");` then `DropColumn("birth_year")`.
- [ ] 10. Write the inverse in `Down(...)`: add `birth_year int`, `UPDATE user_profiles SET birth_year = EXTRACT(YEAR FROM birth_date)::int WHERE birth_date IS NOT NULL;`, drop `birth_date`, drop `location_country` and `location_region`, rename back.
- [ ] 11. In `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, update `PatchUserProfileRequest` to `[property: StringLength(100)] string? LocationCountry, [property: StringLength(100)] string? LocationRegion, [property: StringLength(100)] string? LocationCity, LocalDate? BirthDate, …, bool IsLocationPublic, bool IsBirthDatePublic, …`.
- [ ] 12. Update `UserProfileResponse` the same way: `string? LocationCountry, string? LocationRegion, string? LocationCity, LocalDate? BirthDate, …, bool IsLocationPublic, bool IsBirthDatePublic, …`.
- [ ] 13. Update the `profile.Update(...)` call in `PatchProfileAsync` to pass the new arguments; derive `today` as `clock.GetCurrentInstant().InUtc().Date`.
- [ ] 14. Update `ChangedFields(...)`: replace the `Location`/`BirthYear` lines with `LocationCountry`, `LocationRegion`, `LocationCity`, `BirthDate`, and rename `IsBirthYearPublic` → `IsBirthDatePublic`.
- [ ] 15. Update `ToResponse(...)` to project the new properties in the record's positional order.
- [ ] 16. In `backend/src/Gones.Api/Tournaments/PublicTournamentEndpoints.cs:183-184`, replace with `profile.IsLocationPublic ? JoinLocation(profile) : null,` and `profile.IsBirthDatePublic ? profile.BirthDate?.Year : null,` where `JoinLocation` is a private static helper joining the non-empty parts with `", "` in the order city, region, country. Leave the response record's `string? Location, int? BirthYear` field names unchanged — the public projection contract does not move.
- [ ] 17. `grep -rn "BirthYear\|IsBirthYearPublic\|profile.Location" backend/src backend/tests --include=*.cs | grep -v /obj/ | grep -v /bin/ | grep -v Migrations/` and fix every remaining hit.
- [ ] 18. Add `backend/tests/Gones.UnitTests/UserProfileBirthDateTests.cs` with the first four Test plan rows.
- [ ] 19. Extend `backend/tests/Gones.IntegrationTests/LocalIdentityApiTests.cs` with `Patch_me_round_trips_the_new_shape`, and the participant projection tests in the matching tournament integration test class.
- [ ] 20. Run `npm run backend:test`.
- [ ] 21. Start Postgres (`docker compose up -d postgres`), then run `npm run api:generate`. Commit the regenerated `src/app/api/generated/gones-api.ts`.
- [ ] 22. In `src/app/auth/profile.component.ts`, replace the `location` field with `locationCountry`, `locationRegion`, `locationCity` (three plain text inputs, ids `profile-location-country|region|city`, `data-cy` `profile-location-country|region|city`), replace `birthYear` with `birthDate: string` bound to `<input type="date" id="profile-birth-date" data-cy="profile-birth-date">`, and rename `isBirthYearPublic` → `isBirthDatePublic`.
- [ ] 23. Update `saveProfile()` in the same file to send the new payload fields, sending `undefined` for empty strings.
- [ ] 24. Update `src/app/i18n/messages.ts` (BOTH maps): replace `profile.birthYear` with `profile.birthDate` (en `'Birth date'`, fr `'Date de naissance'`), replace `profile.publicBirthYear` with `profile.publicBirthDate` (en `'Show birth date'`, fr `'Afficher la date de naissance'`), and add `profile.locationCountry` / `profile.locationRegion` / `profile.locationCity` (en `'Country'` / `'Region'` / `'City'`, fr `'Pays'` / `'Région'` / `'Ville'`).
- [ ] 25. Update `cypress/e2e/auth-profile.cy.js` selectors: `[data-cy=profile-location]` → `[data-cy=profile-location-city]`, `[data-cy=profile-birth-year]` → `[data-cy=profile-birth-date]` (type a full ISO date).
- [ ] 26. Run `npm run test && npm run lint && npm run typecheck && npm run build && npm run api:check`.
- [ ] 27. Run `npm run dev` then `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js`.

## Outputs

- Files created: `backend/src/Gones.Infrastructure/Persistence/Migrations/*_SplitProfileLocationAndBirthDate.cs` (+ Designer), `backend/tests/Gones.UnitTests/UserProfileBirthDateTests.cs`.
- Files touched: `backend/src/Gones.Domain/Identity/UserProfile.cs`, `backend/src/Gones.Infrastructure/Persistence/IdentityRecordConfigurations.cs`, `backend/src/Gones.Infrastructure/Persistence/GonesDbContextModelSnapshot.cs`, `backend/src/Gones.Api/Identity/LocalIdentityEndpoints.cs`, `backend/src/Gones.Api/Tournaments/PublicTournamentEndpoints.cs`, `backend/tests/Gones.IntegrationTests/LocalIdentityApiTests.cs`, `src/app/api/generated/gones-api.ts`, `src/app/auth/profile.component.ts`, `src/app/i18n/messages.ts`, `cypress/e2e/auth-profile.cy.js`.
- Public API / behavior change: `PATCH`/`GET /api/users/me` payload fields renamed and split. Breaking for any external consumer; there is none.
- Migrate / config: one EF migration, applied by `Gones.Migrator` on deploy as usual.

## Validation

- [ ] `npm run backend:test` passes
- [ ] `npm run test && npm run lint && npm run typecheck && npm run build` pass
- [ ] `npm run api:check` reports no drift
- [ ] `npm run cy:run -- --spec cypress/e2e/auth-profile.cy.js` passes
- [ ] manual check: seed a row with `birth_year`, run the migration, confirm `birth_date = 'YYYY-01-01'` and `location_city` holds the old string
- [ ] app functional — profile page saves and reloads the new fields
- [ ] commit msg draft: `feat(profile): store a full birth date and a three-part location`
