using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Gones.Api.Errors;
using Gones.Api.Security;
using Gones.Api.Validation;
using Gones.Domain.Organizations;
using Gones.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace Gones.Api.Organizations;

internal static class OrganizationEndpoints
{
    public const int DefaultPageSize = 20;
    public const int MaximumPageSize = 100;

    public static void MapOrganizationEndpoints(this WebApplication app)
    {
        app.MapGet("/api/organizations", ListPublicOrganizationsAsync)
            .AllowAnonymous()
            .Produces<OrganizationListResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest);

        app.MapGet("/api/organizations/{organizationId:guid}", GetPublicOrganizationAsync)
            .AllowAnonymous()
            .Produces<PublicOrganizationResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        var me = app.MapGroup("/api/users").RequireAuthorization(AuthorizationPolicies.User);
        me.MapGet("/me/organizations", ListMyOrganizationsAsync)
            .Produces<IReadOnlyList<MyOrganizationResponse>>();

        var org = app.MapGroup("/api/organizations/{organizationId:guid}")
            .RequireAuthorization(AuthorizationPolicies.User);

        org.MapGet("/members", ListMembersAsync)
            .Produces<IReadOnlyList<OrganizationMemberResponse>>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        // Adding a member is what promotes the account to the global Organizer role, so it is
        // admin-only; removing one and flipping an organization role grant nothing and stay with the
        // Owner. See AdminMembershipGrantRequiredException.
        org.MapPost("/members", AddMemberAsync)
            .RequireAuthorization(AuthorizationPolicies.Admin)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<OrganizationMemberResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        org.MapDelete("/members/{userId:guid}", RemoveMemberAsync)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        org.MapPut("/members/{userId:guid}/role", ChangeMemberRoleAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        // A transfer can hand the organization to someone who is not a member yet, which mints a
        // membership - same reason as POST /members.
        org.MapPost("/transfer-ownership", TransferOwnershipAsync)
            .RequireAuthorization(AuthorizationPolicies.Admin)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        org.MapGet("/notification-settings", GetNotificationSettingsAsync)
            .Produces<OrganizationNotificationSettingsResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        org.MapPut("/notification-settings", UpdateNotificationSettingsAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<OrganizationNotificationSettingsResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    public static void MapAdminOrganizationEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/organizations").RequireAuthorization(AuthorizationPolicies.Admin);

        admin.MapGet("/", ListAdminOrganizationsAsync)
            .Produces<AdminOrganizationListResponse>();
        admin.MapPost("/", CreateOrganizationAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<AdminOrganizationResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        admin.MapPut("/{organizationId:guid}", UpdateOrganizationAsync)
            .AddEndpointFilter<DataAnnotationsValidationFilter>()
            .Produces<AdminOrganizationResponse>()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        admin.MapDelete("/{organizationId:guid}", DeleteOrganizationAsync)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        admin.MapPost("/{organizationId:guid}/restore", RestoreOrganizationAsync)
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        admin.MapGet("/{organizationId:guid}/members", ListAdminOrganizationMembersAsync)
            .Produces<IReadOnlyList<AdminOrganizationMemberResponse>>()
            .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static async Task<IResult> ListPublicOrganizationsAsync(
        string? search,
        int? page,
        int? pageSize,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaximumPageSize);
        var query = database.Organizations.AsNoTracking().Where(item => item.DeletedAt == null);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var normalized = term.ToUpperInvariant();
            query = query.Where(item =>
                item.Name.Contains(term) || item.NormalizedName.Contains(normalized));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(item => item.Name)
            .ThenBy(item => item.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(item => new PublicOrganizationResponse(
                item.Id,
                item.Name,
                item.Description,
                item.Website,
                item.ContactEmail,
                item.CreatedAt))
            .ToListAsync(cancellationToken);
        return Results.Ok(new OrganizationListResponse(items, pageNumber, size, total));
    }

    private static async Task<IResult> GetPublicOrganizationAsync(
        Guid organizationId,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var organization = await database.Organizations.AsNoTracking()
            .Where(item => item.Id == organizationId && item.DeletedAt == null)
            .Select(item => new PublicOrganizationResponse(
                item.Id,
                item.Name,
                item.Description,
                item.Website,
                item.ContactEmail,
                item.CreatedAt))
            .SingleOrDefaultAsync(cancellationToken)
            ?? throw new ResourceNotFoundException();
        return Results.Ok(organization);
    }

    private static async Task<IResult> ListMyOrganizationsAsync(
        ClaimsPrincipal principal,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var userId = OrganizationPrincipal.UserId(principal);
        var items = await (
            from member in database.OrganizationMembers.AsNoTracking()
            join organization in database.Organizations.AsNoTracking() on member.OrganizationId equals organization.Id
            where member.UserId == userId && organization.DeletedAt == null
            orderby organization.Name, organization.Id
            select new MyOrganizationResponse(
                organization.Id,
                organization.Name,
                organization.Description,
                organization.Website,
                organization.ContactEmail,
                member.Role,
                organization.CreatedAt)
        ).ToListAsync(cancellationToken);
        return Results.Ok(items);
    }

    private static async Task<IResult> ListMembersAsync(
        Guid organizationId,
        ClaimsPrincipal principal,
        OrganizationAccessService access,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var userId = OrganizationPrincipal.UserId(principal);
        var isAdmin = OrganizationPrincipal.IsAdmin(principal);
        _ = await access.RequireOwnerAsync(organizationId, userId, isAdmin, cancellationToken);

        var members = await (
            from member in database.OrganizationMembers.AsNoTracking()
            join profile in database.UserProfiles.AsNoTracking() on member.UserId equals profile.UserId
            where member.OrganizationId == organizationId
            orderby member.Role == OrganizationRoles.Owner ? 0 : 1, profile.NormalizedUsername
            select new OrganizationMemberResponse(member.UserId, profile.Username, member.Role, member.CreatedAt)
        ).ToListAsync(cancellationToken);
        return Results.Ok(members);
    }

    private static async Task<IResult> AddMemberAsync(
        Guid organizationId,
        AddOrganizationMemberRequest request,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var actorId = OrganizationPrincipal.UserId(principal);
        var member = await organizations.AddMemberAsync(
            actorId,
            organizationId,
            request.UserId,
            request.Role,
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);
        var username = await database.UserProfiles.AsNoTracking()
            .Where(profile => profile.UserId == member.UserId)
            .Select(profile => profile.Username)
            .SingleAsync(cancellationToken);
        return Results.Created(
            $"/api/organizations/{organizationId:D}/members/{member.UserId:D}",
            new OrganizationMemberResponse(member.UserId, username, member.Role, member.CreatedAt));
    }

    private static async Task<IResult> RemoveMemberAsync(
        Guid organizationId,
        Guid userId,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        await organizations.RemoveMemberAsync(
            OrganizationPrincipal.UserId(principal),
            organizationId,
            userId,
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> ChangeMemberRoleAsync(
        Guid organizationId,
        Guid userId,
        ChangeOrganizationMemberRoleRequest request,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        await organizations.ChangeMemberRoleAsync(
            OrganizationPrincipal.UserId(principal),
            organizationId,
            userId,
            request.Role,
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> TransferOwnershipAsync(
        Guid organizationId,
        TransferOrganizationOwnershipRequest request,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        await organizations.TransferOwnershipAsync(
            OrganizationPrincipal.UserId(principal),
            organizationId,
            request.NewOwnerUserId,
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> GetNotificationSettingsAsync(
        Guid organizationId,
        ClaimsPrincipal principal,
        OrganizationAccessService access,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var userId = OrganizationPrincipal.UserId(principal);
        var isAdmin = OrganizationPrincipal.IsAdmin(principal);
        _ = await access.RequireOwnerAsync(organizationId, userId, isAdmin, cancellationToken);
        var settings = await database.OrganizationNotificationSettings.AsNoTracking()
            .SingleOrDefaultAsync(item => item.OrganizationId == organizationId, cancellationToken)
            ?? throw new ResourceNotFoundException();
        return Results.Ok(ToNotificationResponse(settings));
    }

    private static async Task<IResult> UpdateNotificationSettingsAsync(
        Guid organizationId,
        UpdateOrganizationNotificationSettingsRequest request,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        var settings = await organizations.UpdateNotificationSettingsAsync(
            OrganizationPrincipal.UserId(principal),
            organizationId,
            request.NotifyOnRegistration,
            request.NotifyOnUnregistration,
            OrganizationPrincipal.IsAdmin(principal),
            cancellationToken);
        return Results.Ok(ToNotificationResponse(settings));
    }

    private static async Task<IResult> ListAdminOrganizationsAsync(
        string? search,
        bool? includeDeleted,
        int? page,
        int? pageSize,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? DefaultPageSize : Math.Min(pageSize.Value, MaximumPageSize);
        var query = database.Organizations.AsNoTracking().AsQueryable();
        if (includeDeleted != true)
        {
            query = query.Where(item => item.DeletedAt == null);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            var normalized = term.ToUpperInvariant();
            query = query.Where(item => item.Name.Contains(term) || item.NormalizedName.Contains(normalized));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(item => item.Name)
            .ThenBy(item => item.Id)
            .Skip((pageNumber - 1) * size)
            .Take(size)
            .Select(item => new AdminOrganizationResponse(
                item.Id,
                item.Name,
                item.Description,
                item.Website,
                item.ContactEmail,
                item.DeletedAt,
                item.CreatedAt,
                item.UpdatedAt,
                item.Version,
                database.OrganizationMembers.Count(member => member.OrganizationId == item.Id)))
            .ToListAsync(cancellationToken);
        return Results.Ok(new AdminOrganizationListResponse(items, pageNumber, size, total));
    }

    private static async Task<IResult> ListAdminOrganizationMembersAsync(
        Guid organizationId,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        // Soft-deleted organizations keep their roster, so the 404 rule is the stored row itself.
        var exists = await database.Organizations.AsNoTracking()
            .AnyAsync(item => item.Id == organizationId, cancellationToken);
        if (!exists) throw new ResourceNotFoundException();

        var members = await (
            from member in database.OrganizationMembers.AsNoTracking()
            join user in database.Users.AsNoTracking() on member.UserId equals user.Id
            join profile in database.UserProfiles.AsNoTracking() on user.Id equals profile.UserId
            where member.OrganizationId == organizationId
            orderby member.Role == OrganizationRoles.Owner ? 0 : 1, profile.NormalizedUsername
            select new AdminOrganizationMemberResponse(
                member.UserId,
                profile.Username,
                user.Email ?? string.Empty,
                user.GlobalRole,
                member.Role,
                member.CreatedAt)
        ).ToListAsync(cancellationToken);
        return Results.Ok(members);
    }

    private static async Task<IResult> CreateOrganizationAsync(
        CreateOrganizationRequest request,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var organization = await organizations.CreateAsync(
            OrganizationPrincipal.UserId(principal),
            request.Name,
            request.Description,
            request.Website,
            request.ContactEmail,
            request.OwnerUserId,
            cancellationToken);
        return Results.Created(
            $"/api/admin/organizations/{organization.Id:D}",
            ToAdminResponse(organization, await CountMembersAsync(database, organization.Id, cancellationToken)));
    }

    private static async Task<IResult> UpdateOrganizationAsync(
        Guid organizationId,
        UpdateOrganizationRequest request,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        GonesDbContext database,
        CancellationToken cancellationToken)
    {
        var organization = await organizations.UpdateAsync(
            OrganizationPrincipal.UserId(principal),
            organizationId,
            request.Name,
            request.Description,
            request.Website,
            request.ContactEmail,
            cancellationToken);
        return Results.Ok(ToAdminResponse(organization, await CountMembersAsync(database, organization.Id, cancellationToken)));
    }

    private static async Task<IResult> DeleteOrganizationAsync(
        Guid organizationId,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        await organizations.SoftDeleteAsync(OrganizationPrincipal.UserId(principal), organizationId, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> RestoreOrganizationAsync(
        Guid organizationId,
        ClaimsPrincipal principal,
        OrganizationService organizations,
        CancellationToken cancellationToken)
    {
        await organizations.RestoreAsync(OrganizationPrincipal.UserId(principal), organizationId, cancellationToken);
        return Results.NoContent();
    }

    private static Task<int> CountMembersAsync(GonesDbContext database, Guid organizationId, CancellationToken cancellationToken) =>
        database.OrganizationMembers.AsNoTracking().CountAsync(member => member.OrganizationId == organizationId, cancellationToken);

    private static AdminOrganizationResponse ToAdminResponse(Organization organization, int memberCount) =>
        new(
            organization.Id,
            organization.Name,
            organization.Description,
            organization.Website,
            organization.ContactEmail,
            organization.DeletedAt,
            organization.CreatedAt,
            organization.UpdatedAt,
            organization.Version,
            memberCount);

    private static OrganizationNotificationSettingsResponse ToNotificationResponse(OrganizationNotificationSettings settings) =>
        new(settings.OrganizationId, settings.NotifyOnRegistration, settings.NotifyOnUnregistration, settings.UpdatedAt);
}

internal sealed record OrganizationListResponse(
    IReadOnlyList<PublicOrganizationResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record PublicOrganizationResponse(
    Guid Id,
    string Name,
    string? Description,
    string? Website,
    string? ContactEmail,
    Instant CreatedAt);

internal sealed record MyOrganizationResponse(
    Guid Id,
    string Name,
    string? Description,
    string? Website,
    string? ContactEmail,
    string Role,
    Instant CreatedAt);

internal sealed record OrganizationMemberResponse(
    Guid UserId,
    string Username,
    string Role,
    Instant CreatedAt);

internal sealed record AdminOrganizationMemberResponse(
    Guid UserId,
    string Username,
    string Email,
    string GlobalRole,
    string Role,
    Instant CreatedAt);

internal sealed record AdminOrganizationListResponse(
    IReadOnlyList<AdminOrganizationResponse> Items,
    int Page,
    int PageSize,
    int TotalCount);

internal sealed record AdminOrganizationResponse(
    Guid Id,
    string Name,
    string? Description,
    string? Website,
    string? ContactEmail,
    Instant? DeletedAt,
    Instant CreatedAt,
    Instant UpdatedAt,
    long Version,
    int MemberCount)
{
    /// <summary>A Draft organization is one nobody staffs yet; it is derived, never stored.</summary>
    public bool IsDraft => MemberCount == 0;
}

internal sealed record OrganizationNotificationSettingsResponse(
    Guid OrganizationId,
    bool NotifyOnRegistration,
    bool NotifyOnUnregistration,
    Instant UpdatedAt);

internal sealed record CreateOrganizationRequest(
    [property: Required, StringLength(Organization.MaximumNameLength)] string Name,
    [property: StringLength(Organization.MaximumDescriptionLength)] string? Description,
    [property: StringLength(Organization.MaximumWebsiteLength)] string? Website,
    [property: StringLength(Organization.MaximumContactEmailLength)] string? ContactEmail,
    [property: Required] Guid OwnerUserId);

internal sealed record UpdateOrganizationRequest(
    [property: Required, StringLength(Organization.MaximumNameLength)] string Name,
    [property: StringLength(Organization.MaximumDescriptionLength)] string? Description,
    [property: StringLength(Organization.MaximumWebsiteLength)] string? Website,
    [property: StringLength(Organization.MaximumContactEmailLength)] string? ContactEmail);

internal sealed record AddOrganizationMemberRequest(
    [property: Required] Guid UserId,
    [property: Required, StringLength(20)] string Role);

internal sealed record ChangeOrganizationMemberRoleRequest(
    [property: Required, StringLength(20)] string Role);

internal sealed record TransferOrganizationOwnershipRequest(
    [property: Required] Guid NewOwnerUserId);

internal sealed record UpdateOrganizationNotificationSettingsRequest(
    [property: Required] bool NotifyOnRegistration,
    [property: Required] bool NotifyOnUnregistration);
