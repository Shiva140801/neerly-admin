import { HttpInterceptorFn } from '@angular/common/http';
import { v4 as uuid } from 'uuid';

export const requestIdInterceptor: HttpInterceptorFn = (req, next) => {
  const cloned = req.clone({ setHeaders: { 'X-Request-Id': uuid() } });
  return next(cloned);
};
