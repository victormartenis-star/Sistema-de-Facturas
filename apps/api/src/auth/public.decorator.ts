import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Excluye una ruta del `JwtAuthGuard` global (login, registro, refresh...). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
