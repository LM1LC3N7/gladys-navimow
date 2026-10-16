// -----------------------------------------------------------------------------
// Every SDK handler, registered on a GladysIntegration and delegated to the
// NavimowApp. Shared by index.js and the tests (which register them on the
// SDK's fake Gladys). Register BEFORE connect().
// -----------------------------------------------------------------------------

import { ACTIONS, SCENE_ACTIONS, WIDGETS } from './constants.js';

export function registerHandlers(gladys, app, logger = app.logger) {
  // --- Discovery and commands ----------------------------------------------------
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated(() => app.deviceCreated());
  gladys.onDeviceUpdated(() => app.deviceCreated());
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // --- The Navimow account (Connect button, or the address pasted by hand) --------
  gladys.onOAuthAuthorizeUrl((key, redirectUri) => app.authorizeUrl(key, redirectUri));
  gladys.onOAuthCallback((key, params) => app.oauthCallback(key, params));
  gladys.onAction(ACTIONS.SIGN_IN, (fields) => app.signInWithUrl(fields));

  // --- Scene actions --------------------------------------------------------------
  gladys.onSceneAction(SCENE_ACTIONS.START, (fields) => app.run(fields, 'start'));
  gladys.onSceneAction(SCENE_ACTIONS.PAUSE, (fields) => app.run(fields, 'pause'));
  gladys.onSceneAction(SCENE_ACTIONS.RESUME, (fields) => app.run(fields, 'resume'));
  gladys.onSceneAction(SCENE_ACTIONS.DOCK, (fields) => app.run(fields, 'dock'));

  // --- Dashboard widget ----------------------------------------------------------
  gladys.onWidgetGet(WIDGETS.MOWER, (request) => app.getWidget(request));
  gladys.onWidgetAction(WIDGETS.MOWER, (actionKey, params) => app.widgetAction(actionKey, params));

  // --- Configuration screen button ----------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());

  // --- Configuration changed by the user (poll interval, language) ---------------
  gladys.onConfigUpdated((config) => {
    logger.info('Configuration updated: restarting');
    return app.start(config);
  });

  // --- Connection lifecycle ------------------------------------------------------
  gladys.on('connected', async () => {
    try {
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger.error(`Start failed: ${err.message}`);
    }
  });
  gladys.on('disconnected', () => app.stop());
  gladys.handleShutdown(() => app.shutdown());
}
