using System.Text.Json;
using Gones.Application.Migration;

namespace Gones.UnitTests;

public sealed class MigrationCanonicalJsonTests
{
    [Fact]
    public void Canonical_stringify_matches_javascript_reference_vector()
    {
        // Expected values generated with node: JSON.stringify(sortKeysDeep(payload)) + sha256,
        // mirroring canonicalJsonStringify in src/app/domain/export-schemas.ts.
        const string input = "{\"zeta\":1.5,\"alpha\":\"héllo \\\"quoted\\\" \\n\\t €🎲\",\"nested\":{\"b\":[3,2.25,-4,1e+21,null,true,false],\"a\":\"ok\"},\"empty\":{},\"arr\":[{\"y\":1,\"x\":null}],\"Zcap\":\"\\u0001\",\"a b\":2}";
        const string expected = "{\"Zcap\":\"\\u0001\",\"a b\":2,\"alpha\":\"héllo \\\"quoted\\\" \\n\\t €🎲\",\"arr\":[{\"x\":null,\"y\":1}],\"empty\":{},\"nested\":{\"a\":\"ok\",\"b\":[3,2.25,-4,1e+21,null,true,false]},\"zeta\":1.5}";

        using var document = JsonDocument.Parse(input);
        var canonical = CanonicalJson.Stringify(document.RootElement);

        Assert.Equal(expected, canonical);
        Assert.Equal("b43a6e1cd8111d0a3b50d5bf394bde997c83339f9284fcbe60bd827d9b89aecc", CanonicalJson.Sha256Hex(canonical));
    }

    [Fact]
    public void Sha256_matches_known_vector()
    {
        Assert.Equal("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", CanonicalJson.Sha256Hex("abc"));
    }

    [Fact]
    public void Canonical_stringify_is_invariant_under_key_insertion_order()
    {
        // Property-style check: every permutation of object keys yields the identical canonical bytes.
        var random = new Random(424242);
        var entries = new Dictionary<string, string>
        {
            ["zulu"] = "1", ["Alpha"] = "\"A\"", ["alpha"] = "true", ["a-1"] = "null",
            ["a 2"] = "[1,2]", ["écho"] = "{\"y\":2,\"x\":1}", ["n"] = "-3.5", ["0"] = "\"zero\""
        };
        string? expected = null;
        for (var iteration = 0; iteration < 100; iteration++)
        {
            var shuffled = entries.OrderBy(_ => random.Next()).ToArray();
            var json = "{" + string.Join(",", shuffled.Select(entry => $"\"{entry.Key}\":{entry.Value}")) + "}";
            using var document = JsonDocument.Parse(json);
            var canonical = CanonicalJson.Stringify(document.RootElement);
            expected ??= canonical;
            Assert.Equal(expected, canonical);
        }

        Assert.Equal(new[] { "0", "Alpha", "a 2", "a-1", "alpha", "n", "zulu", "écho" }, ExtractKeys(expected!));
    }

    [Fact]
    public void Checksum_can_skip_top_level_properties()
    {
        using var withChecksum = JsonDocument.Parse("{\"b\":1,\"bundleChecksum\":\"sha256:ff\",\"a\":2}");
        using var withoutChecksum = JsonDocument.Parse("{\"b\":1,\"a\":2}");

        Assert.Equal(
            CanonicalJson.Checksum(withoutChecksum.RootElement),
            CanonicalJson.Checksum(withChecksum.RootElement, ["bundleChecksum"]));
    }

    private static string[] ExtractKeys(string canonicalJson)
    {
        using var document = JsonDocument.Parse(canonicalJson);
        return document.RootElement.EnumerateObject().Select(property => property.Name).ToArray();
    }
}
