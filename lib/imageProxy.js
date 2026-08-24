const IMAGE_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
};

const IMAGE_SIGNATURES = [
  { contentType: 'image/png', matches: (bytes) => bytes.length >= 8 && bytes[0] === 0x89 && bytes.slice(1, 4).toString('ascii') === 'PNG' },
  { contentType: 'image/jpeg', matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { contentType: 'image/gif', matches: (bytes) => bytes.length >= 6 && (bytes.slice(0, 6).toString('ascii') === 'GIF87a' || bytes.slice(0, 6).toString('ascii') === 'GIF89a') },
  { contentType: 'image/webp', matches: (bytes) => bytes.length >= 12 && bytes.slice(0, 4).toString('ascii') === 'RIFF' && bytes.slice(8, 12).toString('ascii') === 'WEBP' },
  { contentType: 'image/svg+xml', matches: (bytes) => bytes.slice(0, 256).toString('utf8').trimStart().startsWith('<svg') },
];

function detectImageContentType(buffer, fallbackContentType = '') {
  const normalized = fallbackContentType.split(';')[0].trim().toLowerCase();
  if (normalized.startsWith('image/')) {
    return normalized;
  }

  const signature = IMAGE_SIGNATURES.find(({ matches }) => matches(buffer));
  return signature?.contentType || 'application/octet-stream';
}

async function proxyImage(req, res) {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing image URL' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(imageUrl);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid image URL' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return res.status(400).json({ error: 'Unsupported image URL protocol' });
  }

  const upstreamResponse = await fetch(parsedUrl, {
    headers: IMAGE_FETCH_HEADERS,
    redirect: 'follow',
  });

  if (!upstreamResponse.ok) {
    return res.status(502).json({ error: `Image fetch failed with status ${upstreamResponse.status}` });
  }

  const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
  const contentType = detectImageContentType(buffer, upstreamResponse.headers.get('content-type') || '');

  if (!contentType.startsWith('image/')) {
    return res.status(415).json({ error: 'URL did not return an image' });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
}

module.exports = {
  proxyImage,
};