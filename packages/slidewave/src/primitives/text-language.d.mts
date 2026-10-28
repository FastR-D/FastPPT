export interface TextLanguages { language?: string | undefined; alternativeLanguage?: string | undefined }
export function isTextLanguage(value: unknown): value is string
export function validateTextLanguages(value: TextLanguages): void
