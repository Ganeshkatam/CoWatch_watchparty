import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import styles from './CircularNavigationWheel.module.css';

import {
  HOLD_THRESHOLD_MS,
  MOVE_JITTER_TOLERANCE_PX,
  MIN_RADIUS,
  MAX_RADIUS,
  DEFAULT_RADIUS,
  WheelNavigationItem,
  normalizeAngle,
  angularDistance,
  getOrbitItemAngle,
} from './navigationPolicy';

export {
  HOLD_THRESHOLD_MS,
  MOVE_JITTER_TOLERANCE_PX,
  MIN_RADIUS,
  MAX_RADIUS,
  DEFAULT_RADIUS,
  type WheelNavigationItem,
  normalizeAngle,
  angularDistance,
  getOrbitItemAngle,
};

export interface CircularNavigationWheelProps {
  items: WheelNavigationItem[];
  currentLocationPath?: string;
  onNavigate?: (item: WheelNavigationItem) => void;
}

type WheelInteractionState = 'CLOSED' | 'OPENING' | 'OPEN' | 'SELECTING' | 'NAVIGATING' | 'CLOSING';

function getResponsiveRadius(): number {
  if (typeof window === 'undefined') return DEFAULT_RADIUS;
  const viewportMin = Math.min(window.innerWidth, window.innerHeight);
  const calculated = Math.round(viewportMin * 0.28);
  return Math.max(MIN_RADIUS, Math.min(calculated, MAX_RADIUS));
}

export const CircularNavigationWheel: React.FC<CircularNavigationWheelProps> = ({
  items,
  onNavigate,
}) => {
  const history = useHistory();
  const [wheelState, setWheelState] = useState<WheelInteractionState>('CLOSED');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [radius, setRadius] = useState<number>(getResponsiveRadius);
  const [navigatingItemId, setNavigatingItemId] = useState<string | null>(null);

  const dockRef = useRef<HTMLButtonElement | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const closingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const dockCenterRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isGestureActiveRef = useRef<boolean>(false);
  const prevSelectedIdRef = useRef<string | null>(null);

  const isOpen = wheelState !== 'CLOSED' && wheelState !== 'CLOSING';

  // Responsive radius updates on window resize/orientationchange
  useEffect(() => {
    const handleResize = () => {
      setRadius(getResponsiveRadius());
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const closeWheel = useCallback(() => {
    if (wheelState === 'CLOSED' || wheelState === 'CLOSING') return;
    setWheelState('CLOSING');
    closingTimerRef.current = setTimeout(() => {
      setWheelState('CLOSED');
      setSelectedItemId(null);
    }, 180);
  }, [wheelState]);

  // Hover handlers for laptop/desktop users
  const handleMouseEnter = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current);
      if (wheelState === 'CLOSED' || wheelState === 'CLOSING') {
        setWheelState('OPEN');
      }
    }
  }, [wheelState]);

  const handleMouseLeave = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        if (wheelState === 'OPEN' || wheelState === 'SELECTING') {
          closeWheel();
        }
      }, 260);
    }
  }, [wheelState, closeWheel]);

  // Determine current active item as center anchor
  const activeItem = items.find((item) => item.isActive) || items[0];
  // Orbit items are all other destinations (held at fixed radial positions)
  const orbitingItems = items.filter((item) => item.id !== activeItem?.id);

  // Trigger smooth navigation with selected destination moving toward center
  const triggerNavigation = useCallback(
    (item: WheelNavigationItem) => {
      setNavigatingItemId(item.id);
      setWheelState('NAVIGATING');

      setTimeout(() => {
        if (item.action) {
          item.action();
        } else if (item.href) {
          history.push(item.href);
        }
        if (onNavigate) {
          onNavigate(item);
        }
        setWheelState('CLOSED');
        setSelectedItemId(null);
        setNavigatingItemId(null);
      }, 190);
    },
    [history, onNavigate]
  );

  // Pointer event handlers on the Center Dock
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (wheelState === 'NAVIGATING') return;

    if (dockRef.current) {
      const rect = dockRef.current.getBoundingClientRect();
      dockCenterRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }

    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    isGestureActiveRef.current = false;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture unavailable
    }

    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);

    if (wheelState === 'CLOSED') {
      holdTimerRef.current = setTimeout(() => {
        isGestureActiveRef.current = true;
        setWheelState('OPEN');
      }, HOLD_THRESHOLD_MS);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pointerDownPosRef.current) return;

    const dx = e.clientX - pointerDownPosRef.current.x;
    const dy = e.clientY - pointerDownPosRef.current.y;
    const moveDist = Math.hypot(dx, dy);

    // If movement passes jitter threshold while closed, enter gesture mode immediately
    if (wheelState === 'CLOSED' && moveDist > MOVE_JITTER_TOLERANCE_PX + 4) {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      isGestureActiveRef.current = true;
      setWheelState('OPEN');
    }

    // Process destination angle selection if wheel is active
    if (wheelState === 'OPEN' || wheelState === 'SELECTING' || isGestureActiveRef.current) {
      const centerX = dockCenterRef.current.x;
      const centerY = dockCenterRef.current.y;
      const pointerAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      const distFromCenter = Math.hypot(e.clientX - centerX, e.clientY - centerY);

      // Angular sector selection: resolve nearest stationary destination in bottom-right arc
      if (distFromCenter >= 24 && orbitingItems.length > 0) {
        setWheelState('SELECTING');

        let nearestItem: WheelNavigationItem | null = null;
        let smallestDiff = Infinity;

        orbitingItems.forEach((item, index) => {
          const itemBaseAngle = getOrbitItemAngle(index, orbitingItems.length);
          const diff = angularDistance(itemBaseAngle, pointerAngle);

          if (diff < smallestDiff) {
            smallestDiff = diff;
            nearestItem = item;
          }
        });

        // Sector threshold: within sector span
        const sectorSpan = Math.PI / Math.max(1, orbitingItems.length);
        if (nearestItem && smallestDiff < sectorSpan * 0.9) {
          const matchedId = (nearestItem as WheelNavigationItem).id;
          if (matchedId !== prevSelectedIdRef.current) {
            try {
              navigator.vibrate?.(8);
            } catch {
              // Ignore haptic errors
            }
            prevSelectedIdRef.current = matchedId;
          }
          setSelectedItemId(matchedId);
        } else {
          setSelectedItemId(null);
          prevSelectedIdRef.current = null;
        }
      } else {
        setSelectedItemId(null);
        prevSelectedIdRef.current = null;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture release fails
    }

    const startPos = pointerDownPosRef.current;
    pointerDownPosRef.current = null;

    if (!startPos) return;

    const moveDist = Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y);

    // Clean tap: if closed and no drag movement occurred
    if (wheelState === 'CLOSED' && moveDist <= MOVE_JITTER_TOLERANCE_PX) {
      setWheelState('OPEN');
      return;
    }

    // Gesture release: if a destination is selected, navigate to it!
    if (selectedItemId) {
      const selected = orbitingItems.find((item) => item.id === selectedItemId);
      if (selected) {
        triggerNavigation(selected);
        return;
      }
    }

    // If already open and user tapped the center dock again, toggle close
    if (wheelState === 'OPEN' && moveDist <= MOVE_JITTER_TOLERANCE_PX) {
      closeWheel();
      return;
    }

    // Otherwise release occurred in empty space / cancel zone
    closeWheel();
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    pointerDownPosRef.current = null;
    closeWheel();
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (orbitingItems.length === 0) return;

    if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        closeWheel();
      }
      return;
    }

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!isOpen) {
        setWheelState('OPEN');
      } else if (selectedItemId) {
        const item = orbitingItems.find((i) => i.id === selectedItemId);
        if (item) triggerNavigation(item);
      } else {
        closeWheel();
      }
      return;
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setWheelState('OPEN');
        setSelectedItemId(orbitingItems[0].id);
        return;
      }
      const currentIndex = orbitingItems.findIndex((i) => i.id === selectedItemId);
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % orbitingItems.length;
      setSelectedItemId(orbitingItems[nextIndex].id);
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setWheelState('OPEN');
        setSelectedItemId(orbitingItems[orbitingItems.length - 1].id);
        return;
      }
      const currentIndex = orbitingItems.findIndex((i) => i.id === selectedItemId);
      const prevIndex =
        currentIndex <= 0 ? orbitingItems.length - 1 : (currentIndex - 1) % orbitingItems.length;
      setSelectedItemId(orbitingItems[prevIndex].id);
      return;
    }
  };

  if (!activeItem) return null;

  const CenterIcon = activeItem.icon;

  // Geometric parameters for flush corner quadrant plate (with balanced outer coverage and breathing room)
  const rightOffset = 51;
  const bottomOffset = 51;
  const outerR = radius + 78;
  const arcRadius = outerR + rightOffset;

  return (
    <nav
      className={styles.wheelRoot}
      role="toolbar"
      aria-label="Circular Navigation Dial"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Capture layer for clean dismissal on outside tap */}
      {isOpen && (
        <div
          className={styles.captureBackdrop}
          onClick={closeWheel}
          aria-hidden="true"
        />
      )}

      {/* Center Dock Container */}
      <div
        className={styles.centerDockContainer}
        onMouseEnter={handleMouseEnter}
      >
        <button
          ref={dockRef}
          type="button"
          className={`${styles.centerDockButton} ${isOpen ? styles.centerDockOpen : ''}`}
          aria-label={`${activeItem.label}, current page. Hover, tap, or drag to open navigation dial.`}
          aria-expanded={isOpen}
          aria-current="page"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleKeyDown}
        >
          <div className={styles.centerDockIconWrapper}>
            <CenterIcon size={22} stroke={2.4} />
            <span className={styles.activeCenterDot} aria-hidden="true" />
          </div>
          <span className={styles.centerDockLabel}>{activeItem.label}</span>
        </button>

        {/* Orbiting destinations and unified quadrant dial plate */}
        {isOpen && (
          <div
            className={styles.orbitArea}
            aria-hidden={!isOpen}
            onMouseEnter={handleMouseEnter}
          >
            {/* Concentric SVG Quadrant Plate seamlessly enclosing main nav hub */}
            <svg
              className={styles.arcGuideSvg}
              viewBox="-310 -310 620 620"
              aria-hidden="true"
            >
              {/* Unified Quadrant Backdrop Plate (Encloses Hub and Destinations) */}
              <path
                className={styles.sectorPlatePath}
                d={`M ${rightOffset} -${outerR} A ${arcRadius} ${arcRadius} 0 0 0 -${outerR} ${bottomOffset} L ${rightOffset} ${bottomOffset} Z`}
              />

              {/* Outer Circular Quadrant Rim */}
              <path
                className={styles.outerRimPath}
                d={`M ${rightOffset} -${outerR} A ${arcRadius} ${arcRadius} 0 0 0 -${outerR} ${bottomOffset}`}
              />

              {/* Inner Hub Guide Ring */}
              <circle
                className={styles.innerDockGuideRing}
                cx="0"
                cy="0"
                r="36"
                fill="none"
              />

              {/* Inner Orbit Track Arc */}
              <path
                className={styles.arcGuidePath}
                d={`M 0 -${radius} A ${radius} ${radius} 0 0 0 -${radius} 0`}
              />

              {/* Subtle Radial Sector Rays connecting dock to each destination */}
              {orbitingItems.map((_, idx) => {
                const angle = getOrbitItemAngle(idx, orbitingItems.length);
                const rayStartX = Math.round(Math.cos(angle) * 34);
                const rayStartY = Math.round(Math.sin(angle) * 34);
                const rayEndX = Math.round(Math.cos(angle) * (radius - 22));
                const rayEndY = Math.round(Math.sin(angle) * (radius - 22));
                return (
                  <line
                    key={`ray-${idx}`}
                    className={styles.radialGuideLine}
                    x1={rayStartX}
                    y1={rayStartY}
                    x2={rayEndX}
                    y2={rayEndY}
                  />
                );
              })}
            </svg>

            {orbitingItems.map((item, index) => {
              const ItemIcon = item.icon;
              const isSelected = selectedItemId === item.id;
              const isNavigating = navigatingItemId === item.id;

              // Stationary polar coordinates in bottom-right corner arc
              const itemBaseAngle = getOrbitItemAngle(index, orbitingItems.length);
              const x = Math.round(Math.cos(itemBaseAngle) * radius);
              const y = Math.round(Math.sin(itemBaseAngle) * radius);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.orbitItem} ${isSelected ? styles.orbitItemSelected : ''} ${
                    isNavigating ? styles.navigatingToCenter : ''
                  }`}
                  style={{
                    transform: isNavigating
                      ? 'translate(0, 0)'
                      : `translate(${x}px, ${y}px) ${isSelected ? 'scale(1.12)' : 'scale(1)'}`,
                  }}
                  aria-label={item.ariaLabel || item.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerNavigation(item);
                  }}
                  onMouseEnter={() => {
                    setSelectedItemId(item.id);
                  }}
                  onMouseLeave={() => {
                    if (selectedItemId === item.id) {
                      setSelectedItemId(null);
                    }
                  }}
                >
                  <div className={styles.orbitItemIconWrapper}>
                    <ItemIcon size={19} stroke={isSelected ? 2.2 : 1.8} />
                  </div>

                  {/* Permanent visible label badge beneath each icon */}
                  <span
                    className={`${styles.orbitItemLabel} ${
                      isSelected ? styles.orbitItemLabelSelected : ''
                    }`}
                    aria-hidden="true"
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
};
