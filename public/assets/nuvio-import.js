'use strict';

(() => {
  const $ = (selector) => document.querySelector(selector);
  const API = 'https://api.nuvio.tv';
  // Clé anon publique utilisée par le client Nuvio Account Manager.
  const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgxNTIxMzQ2LCJleHAiOjE5MzkyMDEzNDZ9.tmQaj682pwzehpqlgCDMnySOqiUvpgRbrE43T4VJpDI';
  let token = '';
  let profiles = [];

  async function api(path, accessToken, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      headers: {
        apikey: API_KEY,
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
        ...(options.headers || {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || body.msg || body.error_description || body.error || ('Erreur HTTP ' + response.status));
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function showError(element, error) {
    element.textContent = error && error.message ? error.message : 'Une erreur est survenue.';
  }

  function init() {
    const dialog = $('#nuvio-dialog');
    const loginForm = $('#nuvio-login');
    const importForm = $('#nuvio-import');
    const loginError = $('#nuvio-login-error');
    const importError = $('#nuvio-import-error');
    const status = $('#nuvio-status');
    const loginButton = $('#nuvio-login-submit');
    const importButton = $('#nuvio-import-submit');

    $('#nuvio-import-open').addEventListener('click', () => {
      loginError.textContent = '';
      importError.textContent = '';
      status.textContent = '';
      loginForm.hidden = false;
      importForm.hidden = true;
      dialog.showModal();
      $('#nuvio-email').focus();
    });

    dialog.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => dialog.close());
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener('close', () => {
      // Le jeton reste uniquement en mémoire tant que la fenêtre est ouverte.
      token = '';
      profiles = [];
      $('#nuvio-password').value = '';
    });

    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      loginError.textContent = '';
      loginButton.disabled = true;
      loginButton.textContent = 'Connexion…';
      try {
        const auth = await api('/auth/v1/token?grant_type=password', '', {
          method: 'POST',
          body: JSON.stringify({
            email: $('#nuvio-email').value.trim(),
            password: $('#nuvio-password').value,
          }),
        });
        token = auth.access_token;
        profiles = await api('/rest/v1/rpc/sync_pull_profiles', token, {
          method: 'POST',
          body: '{}',
        });
        if (!Array.isArray(profiles) || !profiles.length) throw new Error('Aucun profil Nuvio trouvé.');

        const select = $('#nuvio-profile');
        select.replaceChildren(...profiles.map((profile) => {
          const option = document.createElement('option');
          option.value = String(profile.profile_index);
          option.textContent = profile.name || ('Profil ' + (Number(profile.profile_index) + 1));
          return option;
        }));
        loginForm.hidden = true;
        importForm.hidden = false;
        $('#nuvio-password').value = '';
        $('#nuvio-profile').focus();
      } catch (error) {
        token = '';
        showError(loginError, error);
      } finally {
        loginButton.disabled = false;
        loginButton.textContent = 'Se connecter';
      }
    });

    importForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      importError.textContent = '';
      status.textContent = '';
      importButton.disabled = true;
      importButton.textContent = 'Import en cours…';
      try {
        if (!token) throw new Error('La session a expiré. Reconnecte-toi à Nuvio.');
        const profileId = Number($('#nuvio-profile').value);
        const profile = profiles.find((item) => Number(item.profile_index) === profileId);
        if (!profile || !Number.isInteger(profileId)) throw new Error('Choisis un profil valide.');

        const addonUrl = $('#manifest-url').value;
        const collectionUrl = $('#collection-url').value;
        const incomingPromise = fetch(collectionUrl, { cache: 'no-store' }).then((response) => {
          if (!response.ok) throw new Error('Impossible de récupérer les collections Cinévio.');
          return response.json();
        });
        const existingCollectionsPromise = api('/rest/v1/rpc/sync_pull_collections', token, {
          method: 'POST',
          body: JSON.stringify({ p_profile_id: profileId }),
        });
        const addonPromise = $('#nuvio-add-addon').checked
          ? api('/rest/v1/addons?select=*&profile_id=eq.' + encodeURIComponent(profileId) + '&order=sort_order', token)
          : Promise.resolve(null);

        const [incomingValue, collectionRows, addonRows] = await Promise.all([
          incomingPromise, existingCollectionsPromise, addonPromise,
        ]);
        const incoming = Array.isArray(incomingValue) ? incomingValue : [];
        if (!incoming.length) throw new Error('Cinévio n’a généré aucune collection.');

        let existing = collectionRows && collectionRows[0] ? collectionRows[0].collections_json : null;
        if (typeof existing === 'string') {
          try { existing = JSON.parse(existing); } catch { existing = []; }
        }
        if (!Array.isArray(existing)) existing = [];
        const incomingIds = new Set(incoming.map((item) => item && item.id).filter(Boolean));
        const mergedCollections = existing.filter((item) => !item || !incomingIds.has(item.id)).concat(incoming);

        let mergedAddons = null;
        if (addonRows !== null) {
          const addons = Array.isArray(addonRows) ? addonRows : [];
          const found = addons.findIndex((addon) => addon.url === addonUrl);
          const newAddon = {
            url: addonUrl,
            name: document.querySelector('[data-addon-name]')?.textContent || 'Cinévio',
            enabled: true,
            sort_order: found >= 0 ? addons[found].sort_order : addons.length,
          };
          mergedAddons = found >= 0
            ? addons.map((item, index) => index === found ? { ...item, ...newAddon } : ({
              url: item.url, name: item.name, enabled: item.enabled, sort_order: item.sort_order,
            }))
            : addons.map((item) => ({
              url: item.url, name: item.name, enabled: item.enabled, sort_order: item.sort_order,
            })).concat(newAddon);
        }

        // Importer les collections et préserver celles qui ne sont pas gérées par Cinévio.
        await api('/rest/v1/rpc/sync_push_collections', token, {
          method: 'POST',
          body: JSON.stringify({ p_profile_id: profileId, p_collections_json: mergedCollections }),
        });
        if (mergedAddons) {
          await api('/rest/v1/rpc/sync_push_addons', token, {
            method: 'POST',
            body: JSON.stringify({ p_profile_id: profileId, p_addons: mergedAddons }),
          });
        }

        status.textContent = 'Import terminé dans « ' + (profile.name || 'Nuvio') + ' » : ' +
          incoming.length + ' collections ajoutées/mises à jour' +
          (mergedAddons ? ' et addon Cinévio installé.' : '.');
        importButton.textContent = 'Import terminé';
        window.setTimeout(() => dialog.close(), 1800);
      } catch (error) {
        showError(importError, error);
      } finally {
        importButton.disabled = false;
        if (importButton.textContent !== 'Import terminé') importButton.textContent = 'Importer';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
