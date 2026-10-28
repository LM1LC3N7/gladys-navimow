// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button and action
// results, feature names, text states, widget), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Our activities (src/navimow/model.js activityOf). */
const ACTIVITY = {
  mowing: { en: 'Mowing', fr: 'Tonte' },
  mapping: { en: 'Mapping the lawn', fr: 'Cartographie du terrain' },
  paused: { en: 'Paused', fr: 'En pause' },
  returning: { en: 'Returning to the station', fr: 'Retour à la station' },
  docked: { en: 'In the station', fr: 'À la station' },
  charging: { en: 'Charging', fr: 'En charge' },
  idle: { en: 'Idle', fr: "À l'arrêt" },
  lifted: { en: 'Lifted', fr: 'Soulevée' },
  error: { en: 'Error', fr: 'Erreur' },
  updating: { en: 'Software update', fr: 'Mise à jour logicielle' },
  self_check: { en: 'Self-check', fr: 'Autotest' },
  offline: { en: 'Offline', fr: 'Hors ligne' },
  unknown: { en: 'Unknown', fr: 'Inconnu' },
};

/** The error kinds navimow-sdk names (MowerError). */
const ERROR = {
  stuck: { en: 'Stuck', fr: 'Coincée' },
  lifted: { en: 'Lifted', fr: 'Soulevée' },
  rain: { en: 'Rain', fr: 'Pluie' },
  battery_low: { en: 'Battery low', fr: 'Batterie faible' },
  sensor_error: { en: 'Sensor error', fr: 'Erreur de capteur' },
  motor_error: { en: 'Motor error', fr: 'Erreur moteur' },
  blade_error: { en: 'Blade error', fr: 'Erreur de lame' },
  unknown: { en: 'Unknown error', fr: 'Erreur inconnue' },
};

const known = (table, key) => table[key] ?? { en: String(key), fr: String(key) };

const minutesText = (ms) => Math.max(1, Math.round(ms / 60_000));

export const T = {
  activity: (key) => known(ACTIVITY, key),
  errorKind: (key) => ERROR[key],
  errorCode: (code) => ({ en: `Error ${code}`, fr: `Erreur ${code}` }),
  none: { en: '—', fr: '—' },

  // --- Feature names ---------------------------------------------------------------------
  features: {
    state: { en: 'State', fr: 'État' },
    run_mode: { en: 'Mowing (idle: pause)', fr: 'Tonte (arrêt : pause)' },
    dock: { en: 'Return to the station', fr: 'Retour à la station' },
    battery: { en: 'Battery', fr: 'Batterie' },
    activity: { en: 'Activity', fr: 'Activité' },
    error_code: {
      en: 'Error code (0: none, -1: no code)',
      fr: "Code d'erreur (0 : aucune, -1 : sans code)",
    },
    error: { en: 'Error', fr: 'Erreur' },
    connected: { en: 'Online', fr: 'En ligne' },
    progress: { en: 'Mowing progress', fr: 'Avancement de la tonte' },
    mowed_area: { en: 'Area mowed (session)', fr: 'Surface tondue (session)' },
  },
  // Plain strings: the Gladys core refuses a publication whose option label is not one.
  runOptions: {
    pause: 'Pause',
    mow: 'Mow',
  },

  // --- Connection status ---------------------------------------------------------------
  notSignedIn: {
    en: 'Not connected: click "Connect" next to "Navimow account" and sign in with the account of the Navimow app.',
    fr: "Non connecté : cliquez sur « Connecter » à côté de « Compte Navimow » et connectez-vous avec le compte de l'application Navimow.",
  },
  refused: {
    en: 'The Navimow session expired or was refused: click "Connect" next to "Navimow account" to sign in again.',
    fr: 'La session Navimow a expiré ou a été refusée : cliquez sur « Connecter » à côté de « Compte Navimow » pour vous reconnecter.',
  },
  unreachable: (message) => ({
    en: `Navimow is unreachable: ${message}. Retrying in a few minutes.`,
    fr: `Navimow est injoignable : ${message}. Nouvel essai dans quelques minutes.`,
  }),
  renewalRetry: (message, ms) => ({
    en: `The renewal of the Navimow session failed (${message}): retrying in ${minutesText(ms)} min.`,
    fr: `Le renouvellement de la session Navimow a échoué (${message}) : nouvel essai dans ${minutesText(ms)} min.`,
  }),
  noMower: {
    en: 'Connected to Navimow, but the account has no mower: add it in the Navimow app first.',
    fr: "Connecté à Navimow, mais le compte n'a aucune tondeuse : ajoutez-la d'abord dans l'application Navimow.",
  },
  ok: ({ mowers, live, pollMinutes }) => {
    const en = {
      on: `live updates on, status read every ${pollMinutes} min`,
      connecting: 'live updates connecting',
      down: 'live updates down, status read every 2 min until they are back',
    };
    const fr = {
      on: `mises à jour en direct actives, état relu toutes les ${pollMinutes} min`,
      connecting: 'mises à jour en direct en cours de connexion',
      down: "mises à jour en direct coupées, état relu toutes les 2 min jusqu'à leur retour",
    };
    return {
      en: `Connected to Navimow: ${plural(mowers, 'mower')}, ${en[live]}.`,
      fr: `Connecté à Navimow : ${mowers} tondeuse${mowers > 1 ? 's' : ''}, ${fr[live]}.`,
    };
  },

  // --- Sign-in -------------------------------------------------------------------------------
  stateMismatch:
    'This sign-in was not started from this Gladys (or is too old): click "Connect" again.',
  signedIn: (mowers) => ({
    en: `Signed in to Navimow: ${plural(mowers, 'mower')} found. Add ${mowers === 1 ? 'it' : 'them'} from the Discovery tab.`,
    fr: `Connecté à Navimow : ${mowers} tondeuse${mowers > 1 ? 's' : ''} trouvée${mowers > 1 ? 's' : ''}. Ajoutez-${mowers === 1 ? 'la' : 'les'} depuis l'onglet Découverte.`,
  }),
  signedInNoList: {
    en: 'Signed in to Navimow. The mowers will appear in the Discovery tab.',
    fr: "Connecté à Navimow. Les tondeuses apparaîtront dans l'onglet Découverte.",
  },
  noCode: {
    en: 'No authorization code in this address: after signing in, copy the whole address of the page that does not load (it starts with http://localhost:1/callback?code=).',
    fr: "Pas de code d'autorisation dans cette adresse : après la connexion, copiez toute l'adresse de la page qui ne se charge pas (elle commence par http://localhost:1/callback?code=).",
  },
  codeRefused: {
    en: 'Navimow refused this code: a code works once and for a few minutes only. Open the sign-in page again and paste the new address.',
    fr: "Navimow a refusé ce code : un code ne sert qu'une fois et quelques minutes. Rouvrez la page de connexion et collez la nouvelle adresse.",
  },

  // --- The "Test" button ---------------------------------------------------------------
  test: ({ mowers, live }) => {
    const en = [];
    const fr = [];
    if (mowers.length === 0) {
      en.push('Navimow answers, but the account has no mower.');
      fr.push("Navimow répond, mais le compte n'a aucune tondeuse.");
    }
    for (const m of mowers) {
      const battery = m.battery === null ? '?' : `${m.battery} %`;
      en.push(
        `${m.name} (${m.model ?? '?'}): ${T.activity(m.activity).en}, battery ${battery}${m.connected === false ? ', OFFLINE' : ''}.`,
      );
      fr.push(
        `${m.name} (${m.model ?? '?'}) : ${T.activity(m.activity).fr}, batterie ${battery}${m.connected === false ? ', HORS LIGNE' : ''}.`,
      );
    }
    en.push(live ? 'Live updates: connected.' : 'Live updates: not connected (yet).');
    fr.push(
      live
        ? 'Mises à jour en direct : connectées.'
        : 'Mises à jour en direct : pas (encore) connectées.',
    );
    return { en: en.join('\n'), fr: fr.join('\n') };
  },

  // --- Commands --------------------------------------------------------------------------
  unknownMower: (value) => ({
    en: `Unknown mower "${value}": pick a Navimow device.`,
    fr: `Tondeuse inconnue « ${value} » : choisissez un appareil Navimow.`,
  }),
  noMowerForCommand: {
    en: 'No mower to command: sign in to Navimow and add the mower from the Discovery tab.',
    fr: "Aucune tondeuse à commander : connectez-vous à Navimow et ajoutez la tondeuse depuis l'onglet Découverte.",
  },

  // --- Widget ----------------------------------------------------------------------------
  widget: {
    noMower: {
      en: 'No Navimow mower yet: sign in to Navimow in the configuration of the integration.',
      fr: "Aucune tondeuse Navimow : connectez-vous à Navimow dans la configuration de l'intégration.",
    },
    battery: { en: 'Battery', fr: 'Batterie' },
    progress: { en: 'Progress', fr: 'Avancement' },
    activity: { en: 'Activity', fr: 'Activité' },
    error: { en: 'Error', fr: 'Erreur' },
    lastError: { en: 'Last error', fr: 'Dernière erreur' },
    noError: { en: 'None', fr: 'Aucune' },
    connection: { en: 'Connection', fr: 'Connexion' },
    connected: { en: 'Online', fr: 'En ligne' },
    disconnected: { en: 'Offline', fr: 'Hors ligne' },
    live: { en: 'Live updates', fr: 'En direct' },
    liveOn: { en: 'On', fr: 'Actives' },
    liveOff: { en: 'Off', fr: 'Coupées' },
    start: { en: 'Start', fr: 'Démarrer' },
    pause: { en: 'Pause', fr: 'Pause' },
    resume: { en: 'Resume', fr: 'Reprendre' },
    dock: { en: 'Station', fr: 'Station' },
    sent: {
      start: (name) => ({ en: `${name}: start sent`, fr: `${name} : démarrage envoyé` }),
      pause: (name) => ({ en: `${name}: pause sent`, fr: `${name} : pause envoyée` }),
      resume: (name) => ({ en: `${name}: resume sent`, fr: `${name} : reprise envoyée` }),
      dock: (name) => ({
        en: `${name}: back to the station`,
        fr: `${name} : retour à la station`,
      }),
    },
    failed: (message) => ({
      en: `Navimow refused: ${message}`.slice(0, 200),
      fr: `Navimow a refusé : ${message}`.slice(0, 200),
    }),
  },
};

/** One language of a text: a plain string, or { en, fr } with an English fallback. */
export const pick = (text, language) =>
  typeof text === 'string' ? text : (text?.[language] ?? text?.en ?? '');
