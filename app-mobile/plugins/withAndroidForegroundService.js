const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Plugin customizado para declarar o android:foregroundServiceType no manifesto Android.
 * Necessário para Android 14+ (API 34+) que exige que serviços de foreground
 * declarem explicitamente o tipo. Sem isso, o sistema operacional mata o app imediatamente.
 * 
 * Para um app de localização (como o BibiMarcos), o tipo correto é "location".
 */
module.exports = function withAndroidForegroundService(config, props) {
  const foregroundServiceType = props?.foregroundServiceType || 'location';

  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults.manifest;
    const mainApplication = androidManifest.application[0];

    if (mainApplication.service) {
      mainApplication.service.forEach((service) => {
        const serviceName = service.$['android:name'];
        
        // Atribuir tipo de serviço para o TaskService do Expo (responsável pelo rastreamento em 2º plano)
        if (
          serviceName === 'expo.modules.taskmanager.TaskService' ||
          serviceName === 'expo.modules.location.LocationTaskConsumer' ||
          serviceName.includes('BackgroundFetch') ||
          serviceName.includes('Location')
        ) {
          console.log(`[BibiMarcos Plugin] Declarando foregroundServiceType (${foregroundServiceType}) para: ${serviceName}`);
          service.$['android:foregroundServiceType'] = foregroundServiceType;
        }
      });
    }

    return config;
  });
};
