import React, { useState, useEffect, useRef } from 'react';
import { getConsentState, onConsentChange, setConsentState, type ConsentChoice } from '../lib/consent';

interface CookieConsentProps {
    t: (key: string) => string;
    avoidSidebar?: boolean;
    placement?: 'default' | 'top';
}

const MOBILE_BOTTOM_OFFSET_PX = 12; // bottom-3
const DESKTOP_BOTTOM_OFFSET_PX = 24; // sm:bottom-6
const RESERVED_GAP_PX = 12;
// Candidate auth uses z-index 100. Consent must remain actionable while that
// modal is open instead of sitting underneath its full-screen backdrop.
export const COOKIE_CONSENT_LAYER_Z_INDEX = 105;

export function getCookieConsentBottomSpaceCss({
    height,
    bottomPositioned,
    bottomOffsetPx,
    gapPx = RESERVED_GAP_PX,
}: {
    height: number;
    bottomPositioned: boolean;
    bottomOffsetPx: number;
    gapPx?: number;
}): string {
    if (!bottomPositioned || height <= 0) return '0px';
    return `calc(${Math.ceil(height) + bottomOffsetPx + gapPx}px + env(safe-area-inset-bottom))`;
}

const CookieConsent: React.FC<CookieConsentProps> = ({ t, avoidSidebar = false, placement = 'default' }) => {
    const [visible, setVisible] = useState(false);
    const bannerRef = useRef<HTMLDivElement | null>(null);

    // Keep the banner in sync with the single cookie-backed consent state.
    useEffect(() => {
        setVisible(getConsentState() === 'unknown');
        return onConsentChange((state) => setVisible(state === 'unknown'));
    }, []);

    useEffect(() => {
        if (!visible) return undefined;

        const media = window.matchMedia('(min-width: 640px)');
        let animationFrame = 0;

        const updateReservedSpace = () => {
            const isSmUp = media.matches;
            // In the workspace/portal shell the banner moves to the top-right from
            // sm upward, so bottom sticky bars only need reserved space on mobile.
            const topPositioned = placement === 'top';
            const bottomPositioned = !topPositioned && (!avoidSidebar || !isSmUp);
            const bottomOffsetPx = isSmUp && !avoidSidebar ? DESKTOP_BOTTOM_OFFSET_PX : MOBILE_BOTTOM_OFFSET_PX;
            const height = bannerRef.current?.offsetHeight ?? 0;
            const bottomSpace = getCookieConsentBottomSpaceCss({
                height: bottomPositioned ? height : 0,
                bottomPositioned,
                bottomOffsetPx,
            });
            document.documentElement.style.setProperty('--cookie-consent-bottom-space', bottomSpace);
            document.documentElement.style.setProperty('--cookie-consent-top-space', topPositioned && height > 0 ? `${Math.ceil(height) + RESERVED_GAP_PX}px` : '0px');
        };

        const scheduleReservedSpace = () => {
            if (animationFrame) window.cancelAnimationFrame(animationFrame);
            animationFrame = window.requestAnimationFrame(() => {
                animationFrame = 0;
                updateReservedSpace();
            });
        };

        scheduleReservedSpace();
        const resizeObserver = typeof ResizeObserver !== 'undefined' && bannerRef.current
            ? new ResizeObserver(scheduleReservedSpace)
            : null;
        resizeObserver?.observe(bannerRef.current as Element);
        window.addEventListener('resize', scheduleReservedSpace, { passive: true });
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', scheduleReservedSpace);
        } else if (typeof media.addListener === 'function') {
            media.addListener(scheduleReservedSpace);
        }

        return () => {
            if (animationFrame) window.cancelAnimationFrame(animationFrame);
            resizeObserver?.disconnect();
            window.removeEventListener('resize', scheduleReservedSpace);
            if (typeof media.removeEventListener === 'function') {
                media.removeEventListener('change', scheduleReservedSpace);
            } else if (typeof media.removeListener === 'function') {
                media.removeListener(scheduleReservedSpace);
            }
            document.documentElement.style.removeProperty('--cookie-consent-bottom-space');
            document.documentElement.style.removeProperty('--cookie-consent-top-space');
        };
    }, [avoidSidebar, placement, visible]);

    if (!visible) return null;

    const decide = (value: ConsentChoice) => {
        setConsentState(value);
        setVisible(getConsentState() === 'unknown');
    };

    const useTopPlacement = placement === 'top';
    const positionClass = useTopPlacement
        ? 'fixed inset-x-3 top-[calc(4.5rem+env(safe-area-inset-top))] sm:left-1/2 sm:right-auto sm:w-[min(44rem,calc(100vw-2rem))] sm:-translate-x-1/2'
        : avoidSidebar
        ? 'fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] sm:bottom-auto sm:left-4 sm:right-4 sm:top-[calc(4.25rem+env(safe-area-inset-top))] lg:left-auto lg:w-[min(42rem,calc(100vw-18rem))]'
        : 'fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:left-6 sm:right-auto sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:w-[28rem] sm:max-w-[calc(100vw-3rem)] lg:w-[30rem]';
    const panelClass = useTopPlacement || avoidSidebar
        ? 'rounded-xl border border-slate-200 bg-white/95 text-slate-700 shadow-lg shadow-slate-900/10 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200'
        : 'rounded-2xl border border-slate-700 bg-slate-950/95 text-gray-200 shadow-2xl shadow-slate-950/25 backdrop-blur';
    const secondaryButtonClass = useTopPlacement || avoidSidebar
        ? 'pointer-events-auto min-h-8 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900'
        : 'pointer-events-auto min-h-10 rounded-lg border border-slate-600 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-slate-950';
    const primaryButtonClass = useTopPlacement || avoidSidebar
        ? 'pointer-events-auto min-h-8 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-900'
        : 'pointer-events-auto min-h-10 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2 focus:ring-offset-slate-950';

    return (
        <div
            ref={bannerRef}
            className={`${positionClass} pointer-events-none`}
            style={{ zIndex: COOKIE_CONSENT_LAYER_Z_INDEX }}
            role="region"
            aria-live="polite"
            aria-label={t('cookie_consent_aria_label')}
            data-qa="cookie-consent-banner"
        >
            <div className={`pointer-events-none ${panelClass} ${useTopPlacement || avoidSidebar ? 'p-2.5' : 'p-3 sm:p-4'}`}>
                <div className={`${useTopPlacement || avoidSidebar ? 'space-y-2' : ''}`}>
                    <p className={`${useTopPlacement || avoidSidebar ? 'min-w-0 text-[11px] leading-4 text-slate-600 dark:text-slate-300' : 'text-xs leading-5 sm:text-sm'}`}>
                        {t('cookie_consent_message')}{' '}
                        <a
                            href="/privacy.html"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${useTopPlacement || avoidSidebar ? 'text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200' : 'text-blue-400 hover:text-blue-300'} pointer-events-auto underline`}
                        >
                            {t('cookie_consent_learn_more')}
                        </a>
                    </p>
                    <div className={`${useTopPlacement || avoidSidebar ? 'grid grid-cols-2 gap-2 sm:flex sm:justify-end' : 'mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end'}`}>
                        <button
                            type="button"
                            onClick={() => decide('declined')}
                            className={`${secondaryButtonClass} sm:whitespace-nowrap`}
                        >
                            {t('cookie_consent_decline')}
                        </button>
                        <button
                            type="button"
                            onClick={() => decide('accepted')}
                            className={`${primaryButtonClass} sm:whitespace-nowrap`}
                        >
                            {t('cookie_consent_accept')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CookieConsent;
