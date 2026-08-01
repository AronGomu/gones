import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { ApiAccessTokenStore, ApiProblemError } from '../api/api-boundary';
import { AuthService } from './auth.service';

const AUTH_REPLAYED = new HttpContextToken<boolean>(() => false);

export const authSessionInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const tokens = inject(ApiAccessTokenStore);
  return next(request).pipe(catchError((error: unknown) => {
    const status = error instanceof HttpErrorResponse || error instanceof ApiProblemError ? error.status : undefined;
    const isAuthEndpoint = /\/api\/auth\//.test(request.url);
    if (status !== 401 || isAuthEndpoint || request.context.get(AUTH_REPLAYED) || !tokens.token) {
      return throwError(() => error);
    }
    return auth.refreshAccessToken().pipe(
      switchMap(() => next(request.clone({ context: request.context.set(AUTH_REPLAYED, true) }))),
      catchError(refreshError => throwError(() => refreshError))
    );
  }));
};
