using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Gones.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SingularEventImage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
            migrationBuilder.Sql("""
                WITH ranked AS (
                    SELECT id, width,
                           row_number() OVER (
                               PARTITION BY state, COALESCE(event_id, proposal_id)
                               ORDER BY sort_order, id) AS owner_rank
                    FROM event_images
                    WHERE event_id IS NOT NULL OR proposal_id IS NOT NULL
                ), extras AS (
                    SELECT id, width FROM ranked WHERE owner_rank > 1
                ), variant_keys AS (
                    SELECT extras.id,
                           'event-images/' || extras.id::text || '/' || widths.width::text || '.webp' AS object_key
                    FROM extras
                    CROSS JOIN LATERAL unnest(
                        CASE
                            WHEN extras.width < 320 THEN ARRAY[extras.width]
                            ELSE ARRAY(SELECT width FROM unnest(ARRAY[320, 960, 1600]) AS width WHERE width <= extras.width)
                        END) AS widths(width)
                )
                INSERT INTO event_image_object_deletions
                    (object_key, image_id, attempts, next_attempt_at, last_error, created_at)
                SELECT object_key, id, 0, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP
                FROM variant_keys
                ON CONFLICT (object_key) DO NOTHING;

                WITH ranked AS (
                    SELECT id,
                           row_number() OVER (
                               PARTITION BY state, COALESCE(event_id, proposal_id)
                               ORDER BY sort_order, id) AS owner_rank
                    FROM event_images
                    WHERE event_id IS NOT NULL OR proposal_id IS NOT NULL
                )
                DELETE FROM event_images
                WHERE id IN (SELECT id FROM ranked WHERE owner_rank > 1);
                """);
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    proposal_row RECORD;
                    event_v3 jsonb;
                    canonical_payload text;
                    payload_hash text;
                    canonical_envelope text;
                    envelope_hash text;
                BEGIN
                    FOR proposal_row IN
                        SELECT id, payload_json::jsonb AS envelope
                        FROM event_proposals
                        WHERE status = 'Pending'
                          AND (payload_json::jsonb ->> 'version')::int = 2
                          AND jsonb_typeof(payload_json::jsonb -> 'event' -> 'images') = 'array'
                          AND jsonb_array_length(CASE
                              WHEN jsonb_typeof(payload_json::jsonb -> 'event' -> 'images') = 'array'
                              THEN payload_json::jsonb -> 'event' -> 'images'
                              ELSE '[]'::jsonb END) <= 5
                          AND NOT EXISTS (
                              SELECT 1
                              FROM jsonb_array_elements(CASE
                                  WHEN jsonb_typeof(payload_json::jsonb -> 'event' -> 'images') = 'array'
                                  THEN payload_json::jsonb -> 'event' -> 'images'
                                  ELSE '[]'::jsonb END) AS image
                              WHERE jsonb_typeof(image) IS DISTINCT FROM 'object'
                                 OR jsonb_typeof(image -> 'imageId') IS DISTINCT FROM 'string'
                                 OR (image ->> 'imageId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                 OR (image ->> 'imageId') = '00000000-0000-0000-0000-000000000000'
                                 OR (image ? 'altText' AND jsonb_typeof(image -> 'altText') NOT IN ('null', 'string'))
                                 OR length(COALESCE(image ->> 'altText', '')) > 300)
                          AND (
                              jsonb_array_length(payload_json::jsonb -> 'event' -> 'images') = 0
                              OR EXISTS (
                                  SELECT 1
                                  FROM event_images image
                                  WHERE image.id::text = lower(payload_json::jsonb -> 'event' -> 'images' -> 0 ->> 'imageId')
                                    AND image.proposal_id = event_proposals.id
                                    AND image.state = 'ProposalOwned'))
                        FOR UPDATE
                    LOOP
                        IF jsonb_array_length(proposal_row.envelope -> 'event' -> 'images') = 0 THEN
                            WITH variant_keys AS (
                                SELECT image.id,
                                       'event-images/' || image.id::text || '/' || widths.width::text || '.webp' AS object_key
                                FROM event_images image
                                CROSS JOIN LATERAL unnest(
                                    CASE
                                        WHEN image.width < 320 THEN ARRAY[image.width]
                                        ELSE ARRAY(SELECT width FROM unnest(ARRAY[320, 960, 1600]) AS width WHERE width <= image.width)
                                    END) AS widths(width)
                                WHERE image.proposal_id = proposal_row.id
                                  AND image.state = 'ProposalOwned'
                            )
                            INSERT INTO event_image_object_deletions
                                (object_key, image_id, attempts, next_attempt_at, last_error, created_at)
                            SELECT object_key, id, 0, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP
                            FROM variant_keys
                            ON CONFLICT (object_key) DO NOTHING;

                            DELETE FROM event_images
                            WHERE proposal_id = proposal_row.id
                              AND state = 'ProposalOwned';
                        END IF;

                        event_v3 := jsonb_set(
                            (proposal_row.envelope -> 'event') - 'images',
                            '{imageId}',
                            COALESCE(proposal_row.envelope -> 'event' -> 'images' -> 0 -> 'imageId', 'null'::jsonb),
                            true);
                        canonical_payload :=
                            '{"organizationId":' || to_jsonb(event_v3 ->> 'organizationId')::text ||
                            ',"title":' || to_jsonb(btrim(event_v3 ->> 'title'))::text ||
                            ',"summary":' || COALESCE(to_jsonb(NULLIF(btrim(event_v3 ->> 'summary'), ''))::text, 'null') ||
                            ',"bodyMarkdown":' || CASE
                                WHEN NULLIF(btrim(event_v3 ->> 'bodyMarkdown'), '') IS NULL THEN 'null'
                                ELSE to_jsonb(event_v3 ->> 'bodyMarkdown')::text END ||
                            ',"location":{' ||
                                '"streetAddress":' || to_jsonb(btrim(event_v3 -> 'location' ->> 'streetAddress'))::text ||
                                ',"postalCode":' || to_jsonb(btrim(event_v3 -> 'location' ->> 'postalCode'))::text ||
                                ',"city":' || to_jsonb(btrim(event_v3 -> 'location' ->> 'city'))::text ||
                                ',"country":' || to_jsonb(btrim(event_v3 -> 'location' ->> 'country'))::text ||
                                ',"region":' || to_jsonb(btrim(event_v3 -> 'location' ->> 'region'))::text ||
                                ',"timeZoneId":' || to_jsonb(btrim(event_v3 -> 'location' ->> 'timeZoneId'))::text || '}' ||
                            ',"eventType":' || (event_v3 -> 'eventType')::text ||
                            ',"startsAtLocal":' || to_jsonb(btrim(event_v3 ->> 'startsAtLocal'))::text ||
                            ',"capacity":' || (event_v3 -> 'capacity')::text ||
                            ',"formatIds":' || (event_v3 -> 'formatIds')::text ||
                            ',"imageId":' || COALESCE((event_v3 -> 'imageId')::text, 'null') || '}';
                        payload_hash := encode(digest(convert_to(canonical_payload, 'UTF8'), 'sha256'), 'hex');
                        canonical_envelope :=
                            '{"version":3,"payloadHash":' || to_jsonb(payload_hash)::text ||
                            ',"streetAddress":' || to_jsonb(proposal_row.envelope -> 'location' ->> 'streetAddress')::text ||
                            ',"postalCode":' || to_jsonb(proposal_row.envelope -> 'location' ->> 'postalCode')::text ||
                            ',"city":' || to_jsonb(proposal_row.envelope -> 'location' ->> 'city')::text ||
                            ',"country":' || to_jsonb(proposal_row.envelope -> 'location' ->> 'country')::text ||
                            ',"region":' || to_jsonb(proposal_row.envelope -> 'location' ->> 'region')::text ||
                            ',"timeZoneId":' || to_jsonb(proposal_row.envelope -> 'location' ->> 'timeZoneId')::text || '}';
                        envelope_hash := encode(digest(convert_to(canonical_envelope, 'UTF8'), 'sha256'), 'hex');
                        UPDATE event_proposals
                        SET payload_json = jsonb_set(
                            jsonb_set(
                                jsonb_set(
                                    jsonb_set(proposal_row.envelope, '{version}', '3'::jsonb),
                                    '{event}', event_v3),
                                '{payloadHash}', to_jsonb(payload_hash)),
                            '{envelopeHash}', to_jsonb(envelope_hash))
                        WHERE id = proposal_row.id;
                    END LOOP;
                END $$;
                """);

            migrationBuilder.DropIndex(
                name: "ix_event_images_event_id_sort_order",
                table: "event_images");

            migrationBuilder.DropIndex(
                name: "ix_event_images_proposal_id_sort_order",
                table: "event_images");

            migrationBuilder.DropCheckConstraint(
                name: "ck_event_images_alt_text",
                table: "event_images");

            migrationBuilder.DropCheckConstraint(
                name: "ck_event_images_ownership",
                table: "event_images");

            migrationBuilder.DropColumn(
                name: "alt_text",
                table: "event_images");

            migrationBuilder.DropColumn(
                name: "sort_order",
                table: "event_images");

            migrationBuilder.CreateIndex(
                name: "ux_event_images_event_id",
                table: "event_images",
                column: "event_id",
                unique: true,
                filter: "event_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_event_images_proposal_id",
                table: "event_images",
                column: "proposal_id",
                unique: true,
                filter: "proposal_id IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "ck_event_images_ownership",
                table: "event_images",
                sql: "(state='Temporary' AND event_id IS NULL AND proposal_id IS NULL AND expires_at IS NOT NULL) OR (state='ProposalOwned' AND event_id IS NULL AND proposal_id IS NOT NULL AND expires_at IS NOT NULL) OR (state='EventOwned' AND event_id IS NOT NULL AND proposal_id IS NULL AND expires_at IS NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new System.NotSupportedException("Discarded Event images and removed metadata cannot be reconstructed.");
        }
    }
}
