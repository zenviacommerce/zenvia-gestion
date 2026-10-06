// A dedicated header survives gateway API-key normalization. User JWTs never authorize this worker.
export function workerAuthorized(expected:string,internal:string|null,apikey:string|null){return Boolean(expected)&&(internal===expected||(!internal&&apikey===expected));}
