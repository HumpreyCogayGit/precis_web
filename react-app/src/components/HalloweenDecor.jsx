import { useEffect, useRef } from 'react';

// Date-gated so the decoration retires itself after Halloween and returns next
// October, with no deploy needed either way.
export const isHalloweenSeason = (date = new Date()) => (
  date.getMonth() === 9 || (date.getMonth() === 10 && date.getDate() === 1)
);

const SPIDER_SIZE = 60;
const WALK_SPEED = 70;
const FLEE_SPEED = 280;
const FLEE_RADIUS = 130;
const TURN_RATE = 3;
// Keeps a spider's whole body on screen, so it never reads as having gone missing.
const EDGE_MARGIN = 40;

// One side's legs as [hip, knee, foot], for a spider facing +x around (30, 30).
// The other side is the same legs mirrored across the body.
const LEGS = [
  [[34, 27], [42, 17], [53, 13]],
  [[33, 26], [38, 15], [43, 6]],
  [[31, 26], [27, 15], [22, 6]],
  [[29, 27], [20, 18], [9, 11]],
];

const mirror = ([x, y]) => [x, 60 - y];
const SPIDER_LEGS = LEGS.flatMap((leg, index) => [
  { key: `a${index}`, index, points: leg },
  { key: `b${index}`, index, points: leg.map(mirror) },
]);

const Spider = () => (
  <svg className="halloween-spider-art" viewBox="0 0 60 60" aria-hidden="true">
    {SPIDER_LEGS.map(({ key, index, points }) => (
      <polyline
        key={key}
        // Odd and even legs step in opposite phase: the alternating tripod gait
        // real spiders use. See .halloween-leg in App.css.
        className={`halloween-leg${index % 2 ? ' halloween-leg--offset' : ''}`}
        points={points.map((point) => point.join(',')).join(' ')}
        style={{ transformOrigin: `${points[0][0]}px ${points[0][1]}px` }}
      />
    ))}
    <ellipse className="halloween-spider-body" cx="21" cy="30" rx="10" ry="8" />
    <ellipse className="halloween-spider-body" cx="35" cy="30" rx="6" ry="5" />
    <circle className="halloween-spider-eye" cx="39" cy="28" r="1.2" />
    <circle className="halloween-spider-eye" cx="39" cy="32" r="1.2" />
  </svg>
);

const WEB_SIZE = 240;
const WEB_SPOKE_ANGLES = [4, 20, 36, 52, 68, 86];
const WEB_RING_RADII = [46, 88, 130, 172, 214];

const polar = (radius, degrees) => {
  const radians = (degrees * Math.PI) / 180;
  return [radius * Math.cos(radians), radius * Math.sin(radians)];
};

const buildWebPath = () => {
  const spokes = WEB_SPOKE_ANGLES.map((angle) => {
    const [x, y] = polar(WEB_SIZE, angle);
    return `M0 0L${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  // Each ring segment is pulled toward the corner, the sag that makes straight
  // spokes and arcs read as silk rather than as a radar plot.
  const rings = WEB_RING_RADII.flatMap((radius) => (
    WEB_SPOKE_ANGLES.slice(1).map((angle, index) => {
      const previous = WEB_SPOKE_ANGLES[index];
      const [startX, startY] = polar(radius, previous);
      const [controlX, controlY] = polar(radius * 0.86, (previous + angle) / 2);
      const [endX, endY] = polar(radius, angle);
      return `M${startX.toFixed(1)} ${startY.toFixed(1)}Q${controlX.toFixed(1)} ${controlY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    })
  ));
  return [...spokes, ...rings].join('');
};

const WEB_PATH = buildWebPath();

const Web = ({ corner }) => (
  <svg
    className={`halloween-web halloween-web--${corner}`}
    viewBox={`0 0 ${WEB_SIZE} ${WEB_SIZE}`}
    aria-hidden="true"
  >
    <path d={WEB_PATH} />
  </svg>
);

const randomPoint = () => ({
  x: EDGE_MARGIN + Math.random() * Math.max(window.innerWidth - EDGE_MARGIN * 2, 1),
  y: EDGE_MARGIN + Math.random() * Math.max(window.innerHeight - EDGE_MARGIN * 2, 1),
});

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

// Driven from requestAnimationFrame and written straight to the DOM rather than
// through React state, so sixty moves a second never re-render the edition.
const useCrawl = (ref) => {
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const spider = {
      x: window.innerWidth - EDGE_MARGIN * 2,
      y: EDGE_MARGIN * 2,
      heading: Math.PI * 0.75,
      target: randomPoint(),
      restUntil: 0,
      fleeing: false,
    };
    let frame = 0;
    let lastTime = null;

    const handlePointerMove = (event) => {
      const awayX = spider.x - event.clientX;
      const awayY = spider.y - event.clientY;
      const distance = Math.hypot(awayX, awayY);
      if (distance > FLEE_RADIUS) return;
      const scale = (FLEE_RADIUS * 2.5) / (distance || 1);
      spider.target = {
        x: clamp(spider.x + awayX * scale, EDGE_MARGIN, window.innerWidth - EDGE_MARGIN),
        y: clamp(spider.y + awayY * scale, EDGE_MARGIN, window.innerHeight - EDGE_MARGIN),
      };
      spider.restUntil = 0;
      spider.fleeing = true;
    };

    const step = (time) => {
      frame = requestAnimationFrame(step);
      // Capped because a background tab stops delivering frames: without this the
      // first frame back would teleport the spider across the page.
      const elapsed = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      const resting = time < spider.restUntil;
      element.classList.toggle('is-resting', resting);
      if (resting) return;

      const toTargetX = spider.target.x - spider.x;
      const toTargetY = spider.target.y - spider.y;
      if (Math.hypot(toTargetX, toTargetY) < 14) {
        if (!spider.fleeing && Math.random() < 0.45) {
          spider.restUntil = time + 500 + Math.random() * 2500;
        }
        spider.fleeing = false;
        spider.target = randomPoint();
        return;
      }

      const wanted = Math.atan2(toTargetY, toTargetX);
      const turn = Math.atan2(Math.sin(wanted - spider.heading), Math.cos(wanted - spider.heading));
      const rate = TURN_RATE * (spider.fleeing ? 3 : 1);
      spider.heading += clamp(turn, -rate * elapsed, rate * elapsed);

      const speed = spider.fleeing ? FLEE_SPEED : WALK_SPEED;
      // Re-clamped every frame so a window resize cannot strand it off screen.
      spider.x = clamp(
        spider.x + Math.cos(spider.heading) * speed * elapsed,
        EDGE_MARGIN,
        window.innerWidth - EDGE_MARGIN,
      );
      spider.y = clamp(
        spider.y + Math.sin(spider.heading) * speed * elapsed,
        EDGE_MARGIN,
        window.innerHeight - EDGE_MARGIN,
      );
      element.style.transform = `translate(${spider.x - SPIDER_SIZE / 2}px, ${spider.y - SPIDER_SIZE / 2}px) rotate(${spider.heading}rad)`;
    };

    frame = requestAnimationFrame(step);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [ref]);
};

const prefersReducedMotion = () => (
  typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const CrawlingSpider = () => {
  const ref = useRef(null);
  useCrawl(ref);
  return (
    <div className="halloween-crawler" ref={ref}>
      <Spider />
    </div>
  );
};

// Purely decorative: aria-hidden, and pointer-events: none in App.css, so it is
// invisible to screen readers and never takes a click meant for the page beneath.
const HalloweenDecor = () => {
  if (!isHalloweenSeason()) return null;

  return (
    <div className="halloween-decor" aria-hidden="true">
      <Web corner="top-left" />
      <Web corner="top-right" />
      <Web corner="bottom-left" />
      {/* Readers who ask for reduced motion still get a spider: this one only
          hangs there, and its bobbing is switched off in App.css. */}
      <div className="halloween-dangler">
        <Spider />
      </div>
      {!prefersReducedMotion() && <CrawlingSpider />}
    </div>
  );
};

export default HalloweenDecor;
