const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Plugin para forçar usesCleartextTraffic=true no AndroidManifest.xml
 * 
 * Por que isso é necessário?
 * Android 9 (API 28) e superiores bloqueiam todo tráfego HTTP não criptografado por padrão.
 * O BibiMarcos usa um backend HTTP (sem SSL/TLS no Coolify).
 * Sem esse flag, o sistema operacional Android intercepta e rejeita TODOS os requests HTTP,
 * causando o erro "Network request failed" mesmo quando o servidor está online.
 * 
 * O expo-build-properties também define isso, mas este plugin garante diretamente
 * no manifesto para máxima confiabilidade.
 */
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults.manifest;
    const mainApplication = androidManifest.application[0];

    // Força usesCleartextTraffic="true" diretamente no <application>
    mainApplication.$['android:usesCleartextTraffic'] = 'true';

    console.log('[BibiMarcos Plugin] ✅ usesCleartextTraffic=true definido no AndroidManifest.xml');

    return config;
  });
};
