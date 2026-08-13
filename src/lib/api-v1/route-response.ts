import { NextResponse } from 'next/server';

import { ApiV1Error } from './server';

export function apiRouteError(error: unknown): NextResponse {
  if (error instanceof ApiV1Error) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
  }
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Request failed' } },
    { status: 500 },
  );
}
