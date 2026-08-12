using Gones.Domain.Calendar;
using Gones.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Gones.Infrastructure.Persistence;

internal sealed class EventProposalConfiguration : VersionedEntityConfiguration<EventProposal>
{
    public override void Configure(EntityTypeBuilder<EventProposal> builder)
    {
        base.Configure(builder);
        builder.ToTable("event_proposals");
        // The submitted tournament stays opaque JSON: nothing here is ever read by the public
        // calendar, which only knows about events.
        builder.Property(proposal => proposal.PayloadJson).HasColumnType("jsonb");
        builder.Property(proposal => proposal.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(proposal => proposal.RejectionReason).HasMaxLength(EventProposal.MaximumRejectionReasonLength);
        builder.HasIndex(proposal => proposal.SubmittedByUserId);
        // Sweeping expired pending proposals is an index scan, not a table scan.
        builder.HasIndex(proposal => new { proposal.Status, proposal.ExpiresAt });
        builder.HasMany(proposal => proposal.Recipients)
            .WithOne()
            .HasForeignKey(recipient => recipient.ProposalId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(proposal => proposal.Recipients)
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .AutoInclude(false);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(proposal => proposal.SubmittedByUserId).OnDelete(DeleteBehavior.Cascade);
        // A decided proposal outlives the approver's account; the decision timestamp still records that it happened.
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(proposal => proposal.DecidedByUserId).OnDelete(DeleteBehavior.SetNull);
        builder.ToTable(table =>
        {
            table.HasCheckConstraint("ck_tournament_proposal_status", "status IN ('Pending', 'Approved', 'Rejected')");
            table.HasCheckConstraint("ck_tournament_proposal_expiry", "expires_at > created_at");
            table.HasCheckConstraint(
                "ck_tournament_proposal_decision",
                "(status = 'Pending' AND decided_at IS NULL AND rejection_reason IS NULL) OR (status <> 'Pending' AND decided_at IS NOT NULL)");
        });
    }
}

internal sealed class EventProposalRecipientConfiguration : VersionedEntityConfiguration<EventProposalRecipient>
{
    public override void Configure(EntityTypeBuilder<EventProposalRecipient> builder)
    {
        base.Configure(builder);
        builder.ToTable("event_proposal_recipients");
        // Only the SHA-256 hash of a review token is ever stored; the plaintext exists solely
        // inside the mailed link.
        builder.Property(recipient => recipient.TokenHash)
            .HasMaxLength(EventProposalRecipient.TokenHashLength)
            .IsFixedLength();
        builder.HasIndex(recipient => recipient.TokenHash).IsUnique();
        // One token per approver per proposal, so a review link names exactly one approver.
        builder.HasIndex(recipient => new { recipient.ProposalId, recipient.UserId }).IsUnique();
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(recipient => recipient.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.ToTable(table => table.HasCheckConstraint(
            "ck_tournament_proposal_recipient_token_hash",
            "token_hash ~ '^[0-9a-f]{64}$'"));
    }
}
