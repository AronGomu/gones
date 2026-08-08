export function passwordConfirmationErrors(password: string, confirmation: string, message = 'Les mots de passe ne correspondent pas.'): Record<string, string[]> {
  return password === confirmation && confirmation.length > 0 ? {} : { confirmPassword: [message] };
}
