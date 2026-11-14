import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra;

/** The commit the app was built from (`app.config.ts`), shown in the settings and stored with clips. */
export const APP_VERSION: string =
  typeof extra?.appVersion === 'string' ? extra.appVersion : 'unbekannt';

export const BUILT_AT: Date | null =
  typeof extra?.builtAt === 'string' ? new Date(extra.builtAt) : null;
