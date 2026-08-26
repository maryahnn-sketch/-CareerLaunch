/**
 * Privacy-safe PostHog bootstrap for iFindWorth.
 * PostHog is not loaded until the visitor explicitly grants analytics consent.
 */
(function () {
  const CONSENT_KEY = 'ifw_analytics_consent';
  const CONSENT_MODAL_ID = 'ifw-analytics-consent-modal';
  const POSTHOG_PROJECT_KEY = 'phc_p4TSuWAbFEfK946ATixj2k8aCgjTMjeo2eLZnHUtoyvF';
  let posthogInitialized = false;

  function readConsent() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch {
      return null;
    }
  }

  function writeConsent(value) {
    try {
      localStorage.setItem(CONSENT_KEY, value);
    } catch {
      // Storage may be unavailable in strict/privacy browser modes.
    }
  }

  function posthogConfig() {
    return {
      api_host: 'https://us.i.posthog.com',
      defaults: '2026-05-30',
      person_profiles: 'identified_only',
      session_recording: {
        maskAllInputs: true,
        maskInputOptions: {
          password: true,
          email: true,
          text: true,
          tel: true,
          textarea: true,
        },
        maskTextSelector:
          '.ph-career-content, .ph-mask, .path-title, #storyInput, #jdInput, #addExpInput, #convoInput, [id^="strengthenInput"], [id^="storyDetail"]',
      },
      autocapture: {
        css_selector_ignorelist: [
          '.ph-no-capture',
          '[data-ph-no-capture]',
          '.ph-no-autocapture',
          '[data-ph-no-autocapture]',
          '.ph-career-content',
          '.path-title',
          '#storyInput',
          '#jdInput',
          '#addExpInput',
          '#convoInput',
          '[id^="strengthenInput"]',
          '[id^="storyDetail"]',
          'textarea',
          'input[type="text"]',
          'input[type="email"]',
          'input[type="search"]',
        ],
        dom_event_allowlist: ['click', 'submit'],
        capture_copied_text: false,
      },
    };
  }

  function loadPostHogStub() {
    if (window.posthog && window.posthog.__SV) return;
    !(function (t, e) {
      var o, n, p, r;
      e.__SV ||
        (window.posthog && window.posthog.__loaded) ||
        ((window.posthog = e),
        (e._i = []),
        (e.init = function (i, s, a) {
          function g(t, e) {
            var o = e.split('.');
            2 == o.length && ((t = t[o[0]]), (e = o[1])),
              (t[e] = function () {
                t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
              });
          }
          p ||
            (((p = t.createElement('script')).type = 'text/javascript'),
            (p.crossOrigin = 'anonymous'),
            (p.async = !0),
            (p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js'),
            (p.onerror = function () {
              p = null;
            }),
            (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r));
          var u = e;
          for (
            void 0 !== a ? (u = e[a] = []) : (a = 'posthog'),
              u.people = u.people || [],
              u.toString = function (t) {
                var e = 'posthog';
                return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e;
              },
              u.people.toString = function () {
                return u.toString(1) + '.people (stub)';
              },
              o =
                'fo po init Fo Oo qo Zs Lo Bo Ro capture Do vo Go calculateEventProperties Vo register register_once register_for_session unregister unregister_for_session Ko Ao Zo getFeatureFlag getFeatureFlagPayload getFeatureFlagResult getAllFeatureFlags isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync Yo identify setPersonProperties unsetPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset Xo shutdown setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty Qo Uo createPersonProfile setInternalOrTestUser Jo Eo il opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Ho debug Js mn getPageViewId captureTraceFeedback captureTraceMetric Co'.split(
                  ' '
                ),
              n = 0;
            n < o.length;
            n++
          )
            g(u, o[n]);
          e._i.push([i, s, a]);
        }),
        (e.__SV = 1));
    })(document, window.posthog || []);
  }

  function initPostHog() {
    if (posthogInitialized || readConsent() !== 'granted') return;
    loadPostHogStub();
    window.posthog.init(POSTHOG_PROJECT_KEY, posthogConfig());
    posthogInitialized = true;
  }

  function stopPostHog() {
    if (window.posthog && typeof window.posthog.stopSessionRecording === 'function') {
      window.posthog.stopSessionRecording();
    }
    if (window.posthog && typeof window.posthog.opt_out_capturing === 'function') {
      window.posthog.opt_out_capturing();
    }
    posthogInitialized = false;
  }

  function injectConsentStyles() {
    if (document.getElementById('ifw-analytics-consent-styles')) return;

    const style = document.createElement('style');
    style.id = 'ifw-analytics-consent-styles';
    style.textContent = [
      '.ifw-consent-backdrop{position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(32,41,44,.58);backdrop-filter:blur(6px);}',
      '.ifw-consent-card{width:min(100%,480px);background:#fff;border:1px solid #E2DED5;border-radius:20px;padding:28px;box-shadow:0 24px 70px rgba(32,41,44,.24);font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;}',
      '.ifw-consent-kicker{font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:#4F46E5;margin-bottom:8px;}',
      '.ifw-consent-card h2{font-family:"Playfair Display",Georgia,serif;font-size:30px;line-height:1.1;margin:0 0 10px;color:#171C1E;}',
      '.ifw-consent-card p{font-size:15px;line-height:1.55;color:#30383A;margin:0 0 20px;}',
      '.ifw-consent-actions{display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;}',
      '.ifw-consent-button{min-height:46px;border:0;border-radius:999px;padding:0 20px;font-weight:700;font-size:14px;cursor:pointer;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;}',
      '.ifw-consent-primary{background:#4F46E5;color:#fff;flex:1;}',
      '.ifw-consent-secondary{background:#F0EEE8;color:#171C1E;flex:1;}',
      '.footer-privacy{margin:12px auto 0;text-align:center;}',
      '.footer-privacy-link{background:none;border:0;padding:0;font:inherit;font-size:12px;color:#5C6669;text-decoration:underline;text-decoration-color:#E2DED5;text-underline-offset:3px;cursor:pointer;}',
      '.footer-privacy-link:hover{color:#171C1E;text-decoration-color:#171C1E;}',
      '@media (max-width:520px){.ifw-consent-card{padding:24px 20px}.ifw-consent-card h2{font-size:27px}}',
    ].join('');
    document.head.appendChild(style);
  }

  function closeConsentModal() {
    document.getElementById(CONSENT_MODAL_ID)?.remove();
  }

  function applyConsent(choice) {
    writeConsent(choice);
    if (choice === 'granted') {
      initPostHog();
    } else {
      stopPostHog();
    }
    closeConsentModal();
  }

  function showConsentModal() {
    injectConsentStyles();
    closeConsentModal();

    const backdrop = document.createElement('div');
    backdrop.id = CONSENT_MODAL_ID;
    backdrop.className = 'ifw-consent-backdrop';
    backdrop.innerHTML = [
      '<div class="ifw-consent-card" role="dialog" aria-modal="true" aria-labelledby="ifwConsentTitle">',
      '<div class="ifw-consent-kicker">Private beta</div>',
      '<h2 id="ifwConsentTitle">Help us improve iFindWorth</h2>',
      '<p>We use privacy-conscious analytics to understand how the private beta is working. Sensitive typed and generated career content is masked in session recordings. Declining analytics will not affect your access.</p>',
      '<div class="ifw-consent-actions">',
      '<button type="button" class="ifw-consent-button ifw-consent-primary" id="ifwConsentAllow">Allow analytics</button>',
      '<button type="button" class="ifw-consent-button ifw-consent-secondary" id="ifwConsentDecline">Continue without analytics</button>',
      '</div>',
      '</div>',
    ].join('');
    document.body.appendChild(backdrop);
    backdrop.querySelector('#ifwConsentAllow').addEventListener('click', () => applyConsent('granted'));
    backdrop.querySelector('#ifwConsentDecline').addEventListener('click', () => applyConsent('denied'));
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-ifw-analytics-choices]');
    if (!trigger) return;
    event.preventDefault();
    showConsentModal();
  });

  window.ifwAnalyticsConsent = {
    get: readConsent,
    open: showConsentModal,
    grant: () => applyConsent('granted'),
    deny: () => applyConsent('denied'),
  };

  const existingConsent = readConsent();
  if (existingConsent === 'granted') {
    initPostHog();
  } else if (existingConsent !== 'denied') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showConsentModal);
    } else {
      showConsentModal();
    }
  }
})();
