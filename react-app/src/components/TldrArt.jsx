// Generated cover art for TLDR items. Digest items carry no image of their own, and
// borrowing the source's og:image would put a dozen unrelated brand styles side by
// side, so each item gets an SVG drawn from its lead tag instead: the tag picks a
// motif and palette, the article URL seeds the layout. Same article, same picture,
// on every render and every device -- no image host, no network request.
//
// The motifs borrow from the source art the front page already shows: particle
// swirls, glowing light beams, stacked product panels, node graphs, tiled glyph
// patterns and soft colour fields, all on dark grounds.

const W = 400;
const H = 225;

// Tag name (blogscraper/taxonomy.py) -> [motif, topics it rolls up to]. Tags not
// listed here (GENERAL, and the Advisory/Podcast format tags) say nothing about
// subject, so they never lead.
const AI = ['AI'];
const CYBER = ['Cyber Security'];
const TAGS = {
  'LLM Release': ['particles', AI],
  'AI Research & Benchmarks': ['particles', AI],
  Interpretability: ['particles', AI],
  'Multimodal AI': ['particles', AI],
  'Generative Media': ['particles', AI],
  'Computer Vision': ['particles', AI],
  'Open Source Models': ['particles', AI],

  'AI Hardware & Chips': ['beams', AI],
  'AI Inference & Serving': ['beams', AI],
  'AI Data Centers & Energy': ['beams', AI],
  'Model Training & Fine-tuning': ['beams', AI],
  'Model Efficiency & Quantization': ['beams', AI],
  'Local & Edge AI': ['beams', AI],

  'AI Cloud Platforms': ['stack', AI],
  'Developer Tools for AI': ['stack', AI],
  'Retrieval & Vector Search': ['stack', AI],
  'Enterprise AI Adoption': ['stack', AI],
  'AI Coding Agents': ['stack', AI],
  'Cloud & SaaS Security': ['stack', CYBER],
  'Zero Trust & Architecture': ['stack', CYBER],
  'Identity & Access (IAM)': ['stack', CYBER],

  'Agentic AI': ['network', AI],
  'Robotics & Embodied AI': ['network', AI],
  'Reinforcement Learning': ['network', AI],
  'AI for Science': ['network', AI],
  'AI in Healthcare': ['network', AI],
  'Network & IoT Security': ['network', CYBER],
  'Nation-State / APT': ['network', CYBER],
  'Threat Intelligence': ['network', CYBER],

  'Vulnerability Disclosure': ['glyphs', CYBER],
  'Zero-Day / Exploit': ['glyphs', CYBER],
  'Malware & Trojans': ['glyphs', CYBER],
  Ransomware: ['glyphs', CYBER],
  'Data Breach': ['glyphs', CYBER],
  'Phishing & Social Engineering': ['glyphs', CYBER],
  'Red Team / Pentest Tools': ['glyphs', CYBER],
  'AI Security': ['glyphs', ['Cyber Security', 'AI']],

  'AI Policy & Regulation': ['glow', AI],
  'AI Business & Funding': ['glow', AI],
  'AI Safety & Alignment': ['glow', AI],
  'Industry Commentary': ['glow', CYBER],
};

const TOPIC_MOTIFS = { AI: 'particles', 'Cyber Security': 'glyphs' };

const PALETTES = {
  particles: { bg0: '#050507', bg1: '#17142a', accent: '#ff5c8a', ink: '#f4f1ff' },
  beams: { bg0: '#070302', bg1: '#2b0f03', accent: '#ff7a1a', ink: '#ffd9b0' },
  stack: { bg0: '#0c0d10', bg1: '#1d2027', accent: '#8bb6df', ink: '#ffffff' },
  network: { bg0: '#03100e', bg1: '#0b2c28', accent: '#4fd1b5', ink: '#e6fff9' },
  glyphs: { bg0: '#060606', bg1: '#191919', accent: '#f5c518', ink: '#ffffff' },
  glow: { bg0: '#12072a', bg1: '#4a2a86', accent: '#b89cff', ink: '#ffffff' },
};

// The tag the art is about: the first subject tag that belongs to the digest's own
// topic (an item under Cyber Security tagged "Agentic AI, AI Security" should look
// like security), then any subject tag, then the topic itself.
export const leadTag = (tags, topic) => {
  const subjects = (Array.isArray(tags) ? tags : []).filter((tag) => TAGS[tag]);
  return subjects.find((tag) => TAGS[tag][1].includes(topic)) ?? subjects[0] ?? topic;
};

export const motifFor = (tag, topic) => TAGS[tag]?.[0] ?? TOPIC_MOTIFS[topic] ?? 'particles';

const hashString = (value) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// mulberry32: tiny, fast, and good enough to scatter shapes deterministically.
const seededRandom = (seed) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const round = (n) => Math.round(n * 10) / 10;

const MOTIFS = {
  // A drifting particle band with one accent thread through it.
  particles: (rng, p) => {
    const phase = rng() * Math.PI * 2;
    const tilt = (rng() - 0.5) * 0.5;
    const dots = [];
    for (let i = 0; i < 340; i += 1) {
      const t = rng();
      const spread = (rng() + rng() - 1) * (12 + 48 * Math.sin(t * Math.PI));
      const x = t * W;
      const y = H / 2 + Math.sin(t * Math.PI * 2 + phase) * H * 0.18 + tilt * (x - W / 2) + spread;
      dots.push(
        <circle key={i} cx={round(x)} cy={round(y)} r={round(0.4 + rng() * 1.1)} fill={p.ink} opacity={round(0.2 + rng() * 0.8)} />,
      );
    }
    const thread = `M ${round(W * 0.12)} ${round(H * (0.55 + rng() * 0.25))} Q ${round(W * 0.5)} ${round(H * (0.05 + rng() * 0.3))} ${round(W * 0.88)} ${round(H * (0.3 + rng() * 0.3))}`;
    return (
      <>
        {dots}
        <path d={thread} fill="none" stroke={p.accent} strokeWidth="1.2" opacity="0.85" />
      </>
    );
  },

  // Tall angled light beams, like looking into a rack of glowing silicon.
  beams: (rng, p, id) => {
    const angle = 10 + rng() * 14;
    return (
      <>
        <defs>
          <linearGradient id={`${id}-beam`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={p.accent} stopOpacity="0" />
            <stop offset="0.6" stopColor={p.accent} stopOpacity="0.95" />
            <stop offset="0.68" stopColor={p.ink} stopOpacity="0.55" />
            <stop offset="1" stopColor={p.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 5 }, (_, i) => {
          const x = W * (0.02 + i * 0.21 + (rng() - 0.5) * 0.08);
          return (
            <rect
              key={i}
              x={round(x)}
              y={-H * 0.4}
              width={round(36 + rng() * 64)}
              height={H * 1.8}
              fill={`url(#${id}-beam)`}
              opacity={round(0.3 + rng() * 0.7)}
              transform={`rotate(${round(angle)} ${round(x)} ${H / 2})`}
            />
          );
        })}
      </>
    );
  },

  // Offset, stacked panels: platforms, tools, layers of a system.
  stack: (rng, p) => Array.from({ length: 4 }, (_, i) => {
    const x = 96 + i * 30;
    const y = 22 + i * 48;
    const lead = i === 0;
    return (
      <g key={i}>
        <rect x={x} y={y} width={W} height={38} rx="6" fill={lead ? p.ink : '#ffffff'} opacity={lead ? 0.94 : round(0.07 + i * 0.02)} />
        <rect x={x + 14} y={y + 15} width={round(34 + rng() * 60)} height="8" rx="2" fill={lead ? p.bg0 : p.accent} opacity={lead ? 0.8 : 0.7} />
        {Array.from({ length: 3 }, (__, k) => (
          <circle key={k} cx={x + 170 + k * 22} cy={y + 19} r="5" fill={p.accent} opacity={round(0.45 + rng() * 0.5)} />
        ))}
      </g>
    );
  }),

  // A node graph with one highlighted hub: agents, actors, connected systems.
  network: (rng, p) => {
    const nodes = Array.from({ length: 16 }, () => ({ x: 20 + rng() * (W - 40), y: 16 + rng() * (H - 32), r: 2 + rng() * 3 }));
    const edges = [];
    nodes.forEach((a, i) => {
      nodes.slice(i + 1).forEach((b, j) => {
        if (Math.hypot(a.x - b.x, a.y - b.y) < 120) {
          edges.push(<line key={`${i}-${j}`} x1={round(a.x)} y1={round(a.y)} x2={round(b.x)} y2={round(b.y)} stroke={p.accent} strokeWidth="0.8" opacity="0.35" />);
        }
      });
    });
    const [hub] = nodes;
    return (
      <>
        {edges}
        {nodes.map((node, i) => (
          <circle key={i} cx={round(node.x)} cy={round(node.y)} r={round(node.r)} fill={p.accent} opacity="0.9" />
        ))}
        <circle cx={round(hub.x)} cy={round(hub.y)} r="18" fill="none" stroke={p.accent} strokeWidth="1" opacity="0.5" />
        <circle cx={round(hub.x)} cy={round(hub.y)} r="7" fill={p.ink} />
      </>
    );
  },

  // A tiled field of small shapes fading out from one corner, a few lit up.
  glyphs: (rng, p) => {
    const size = 25;
    const cols = W / size;
    const rows = Math.ceil(H / size);
    const shapes = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const cx = col * size + size / 2;
        const cy = row * size + size / 2;
        const s = 7;
        const lit = rng() < 0.035;
        const fill = lit ? p.accent : p.ink;
        const opacity = lit ? 0.95 : round(0.04 + 0.34 * (col / cols) * (1 - row / rows));
        const kind = Math.floor(rng() * 4);
        const key = `${row}-${col}`;
        if (kind === 0) {
          shapes.push(<circle key={key} cx={cx} cy={cy} r={s} fill={fill} opacity={opacity} />);
        } else if (kind === 1) {
          shapes.push(<polygon key={key} points={`${cx},${cy - s} ${cx + s},${cy + s} ${cx - s},${cy + s}`} fill={fill} opacity={opacity} />);
        } else if (kind === 2) {
          shapes.push(<rect key={key} x={cx - s + 1} y={cy - s + 1} width={2 * s - 2} height={2 * s - 2} fill={fill} opacity={opacity} />);
        } else {
          shapes.push(<polygon key={key} points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`} fill={fill} opacity={opacity} />);
        }
      }
    }
    return shapes;
  },

  // Soft colour fields and faint rings: policy, money, commentary.
  glow: (rng, p, id) => {
    const cx = W * (0.55 + rng() * 0.3);
    const cy = H * (0.3 + rng() * 0.4);
    return (
      <>
        <defs>
          <radialGradient id={`${id}-blob`}>
            <stop offset="0" stopColor={p.accent} stopOpacity="0.75" />
            <stop offset="1" stopColor={p.accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={round(cx)} cy={round(cy)} r="150" fill={`url(#${id}-blob)`} />
        <circle cx={round(W * rng() * 0.4)} cy={round(H * (0.6 + rng() * 0.4))} r="110" fill={`url(#${id}-blob)`} opacity="0.6" />
        {[40, 72, 104].map((r) => (
          <circle key={r} cx={round(cx)} cy={round(cy)} r={r} fill="none" stroke={p.ink} strokeWidth="1" opacity="0.16" />
        ))}
      </>
    );
  },
};

const TldrArt = ({ item, topic }) => {
  const tag = leadTag(item.tags, topic);
  const motif = motifFor(tag, topic);
  const palette = PALETTES[motif];
  const seed = hashString(item.article_url || item.title || tag || '');
  const rng = seededRandom(seed);
  // Gradient ids live in one document-wide namespace, so they carry the seed.
  const id = `tldr-art-${seed.toString(36)}`;

  return (
    <div className={`tldr-art tldr-art--${motif}`} data-motif={motif}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={palette.bg0} />
            <stop offset="1" stopColor={palette.bg1} />
          </linearGradient>
          <radialGradient id={`${id}-halo`} cx="0.82" cy="0.12" r="0.7">
            <stop offset="0" stopColor={palette.accent} stopOpacity="0.3" />
            <stop offset="1" stopColor={palette.accent} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.45" stopColor={palette.bg0} stopOpacity="0" />
            <stop offset="1" stopColor={palette.bg0} stopOpacity="0.85" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${id}-bg)`} />
        <rect width={W} height={H} fill={`url(#${id}-halo)`} />
        {MOTIFS[motif](rng, palette, id)}
        <rect width={W} height={H} fill={`url(#${id}-shade)`} />
      </svg>
      <span className="tldr-art-label">{tag}</span>
    </div>
  );
};

export default TldrArt;
