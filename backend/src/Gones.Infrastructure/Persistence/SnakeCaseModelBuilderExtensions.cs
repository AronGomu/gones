using System.Text;
using Microsoft.EntityFrameworkCore;

namespace Gones.Infrastructure.Persistence;

internal static class SnakeCaseModelBuilderExtensions
{
    public static void UseSnakeCaseNames(this ModelBuilder modelBuilder)
    {
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            if (entity.GetTableName() is { } tableName) entity.SetTableName(ToSnakeCase(tableName));
            foreach (var property in entity.GetProperties()) property.SetColumnName(ToSnakeCase(property.Name));
            foreach (var key in entity.GetKeys())
            {
                if (key.GetName() is { } name) key.SetName(ToSnakeCase(name));
            }
            foreach (var foreignKey in entity.GetForeignKeys())
            {
                if (foreignKey.GetConstraintName() is { } name) foreignKey.SetConstraintName(ToSnakeCase(name));
            }
            foreach (var index in entity.GetIndexes())
            {
                if (index.GetDatabaseName() is { } name) index.SetDatabaseName(ToSnakeCase(name));
            }
        }
    }

    private static string ToSnakeCase(string value)
    {
        var result = new StringBuilder(value.Length + 8);
        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];
            if (char.IsUpper(character)
                && index > 0
                && value[index - 1] != '_'
                && (char.IsLower(value[index - 1]) || char.IsDigit(value[index - 1]) || (index + 1 < value.Length && char.IsLower(value[index + 1]))))
            {
                result.Append('_');
            }
            result.Append(char.ToLowerInvariant(character));
        }
        return result.ToString();
    }
}
