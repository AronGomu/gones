using System.ComponentModel.DataAnnotations;
using Gones.Api.Errors;

namespace Gones.Api.Validation;

public sealed class DataAnnotationsValidationFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var failures = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var argument in context.Arguments.Where(value => value is not null && !IsFrameworkType(value.GetType())))
        {
            var results = new List<ValidationResult>();
            if (Validator.TryValidateObject(argument!, new ValidationContext(argument!), results, validateAllProperties: true)) continue;
            foreach (var result in results)
            {
                var members = result.MemberNames.DefaultIfEmpty(string.Empty);
                foreach (var member in members)
                {
                    if (!failures.TryGetValue(member, out var messages)) failures[member] = messages = [];
                    messages.Add(result.ErrorMessage ?? "Invalid value.");
                }
            }
        }

        if (failures.Count > 0)
        {
            throw new ApiValidationException(failures.ToDictionary(pair => pair.Key, pair => pair.Value.Distinct(StringComparer.Ordinal).ToArray(), StringComparer.Ordinal));
        }

        return await next(context);
    }

    private static bool IsFrameworkType(Type type) => type == typeof(HttpContext)
        || type == typeof(HttpRequest)
        || type == typeof(HttpResponse)
        || type == typeof(CancellationToken)
        || type.IsPrimitive
        || type == typeof(string);
}
