namespace Gones.Domain.Catalog;

/// <summary>
/// Bundled Legacy archetype baseline used to seed the global Deck Archetype catalog.
/// Keep in sync with src/app/config/legacy-archetype-presets.ts (frontend bundled copy).
/// </summary>
public static class DeckArchetypePresets
{
    public static readonly IReadOnlyList<string> LegacyNames =
    [
        "Reanimator (Rakdos)",
        "Tempo (Dimir)",
        "Delver (Izzet)",
        "Show and Tell (Blue)",
        "Sneak and Show (Izzet)",
        "Cephalid Breakfast (Simic)",
        "Dragon Stompy (Red)",
        "Eldrazi (Colorless)",
        "Mystic Forge (Colorless)",
        "Death and Taxes (White)",
        "Control (UWx)",
        "Lands (Gruul)",
        "Cloudpost (Blue)",
        "Oops All Spells (Jund)",
        "Nadu (Simic)",
        "Painter (Red)",
        "Doomsday (Dimir)",
        "Canadian Threshold (Temur)",
        "Artifacts (Blue)",
        "The EPIC Storm (Grixis)",
        "Initiative Stompy (White)",
        "Energy (Mardu)",
        "Energy (Boros)",
        "Maverick (Selesnya)",
        "Ninjas (Dimir)",
        "Control (Grixis)",
        "Control (Sultai)",
        "Control (Bant)",
        "Stoneblade (Azorius)",
        "Cradle Control (Green)",
        "Stiflenought (Blue)",
        "Dark Depths (Golgari)",
        "Goblins (Red)",
        "Merfolk (Blue)",
        "Dredge (Black)",
        "Elves (Green)",
        "Aluren (Sultai)",
        "Infect (Simic)",
        "Storm (Red)",
        "Turbo Depths (Golgari)",
        "Affinity (Blue)",
        "Burn (Red)",
        "Humans (White)",
        "Pox (Black)",
        "Nic Fit (Golgari)",
        "Reanimator (Black)",
        "Omni-Tell (Blue)",
        "Control (Jeskai)",
        "Beanstalk Control (Bant)"
    ];
}
