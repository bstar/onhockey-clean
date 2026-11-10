const { load } = require('cheerio');
const { createHash } = require('node:crypto');
const ORIGIN = 'https://onhockey.tv/';

function publicUrl(value, base = ORIGIN) {
  try {
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') || host.includes(':')) return null;
    if (/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return null;
    return url.href;
  } catch { return null; }
}

// Only unwrap formats whose parameters have been verified against the site.
function resolveSource(href) {
  const original = publicUrl(href);
  if (!original) return null;
  const url = new URL(original);
  const channel = url.searchParams.get('channel');
  if (url.hostname === 'onhockey.tv' && channel) {
    if (url.pathname === '/np_stream400.php') {
      const direct = publicUrl(channel);
      if (direct) return { url: direct, kind: 'embed' };
    }
    if (url.pathname === '/np_youtube.php' && /^[\w-]{11}$/.test(channel)) {
      return { url: `https://www.youtube-nocookie.com/embed/${channel}?autoplay=1`, kind: 'embed' };
    }
    if (url.pathname === '/np_vk.php' && /^-?\d+&id=\d+$/.test(channel)) {
      const params = new URLSearchParams(channel.replace(/^(-?\d+)&id=/, 'oid=$1&id='));
      params.set('autoplay', '1');
      return { url: `https://vkvideo.ru/video_ext.php?${params}`, kind: 'embed' };
    }
    if (url.pathname === '/np_webcaster.php' && /^[\w/-]+$/.test(channel)) {
      return { url: `https://webcaster.pro/iframe/feed/start/${channel}?lang=en&autostart=1`, kind: 'embed' };
    }
    if (url.pathname === '/np_fluidtv.php') {
      const direct = publicUrl(channel);
      if (direct && /\.m3u8(?:\?|$)/i.test(direct)) return { url: direct, kind: 'hls' };
    }
  }
  return { url: original, kind: /\.m3u8(?:\?|$)/i.test(original) ? 'hls' : 'page' };
}

function parseSchedule(html) {
  const $ = load(html);
  if (!$('#gametable').length) throw new Error('The schedule is unavailable or its format has changed. Try refreshing in a moment.');
  const games = [];
  $('#gametable > tbody').each((_, body) => {
    const league = $(body).find('tr').first().find('b').first().text().trim();
    const region = $(body).attr('class') || '';
    if (!league) return;
    $(body).find('tr.game').each((_, row) => {
      const cells = $(row).children('td');
      const title = cells.eq(1).clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
      const utcTime = cells.eq(0).text().replace(/\s+/g, '').trim();
      if (!title) return;
      const sources = [];
      $(row).find('.gamelinks a').each((_, anchor) => {
        const source = resolveSource($(anchor).attr('href'));
        if (source && !sources.some(s => s.url === source.url)) sources.push({
          ...source,
          label: $(anchor).text().trim() || 'Stream',
          detail: $(anchor).attr('title')?.replace('(opens in a new tab)', '').trim() || '',
          original: publicUrl($(anchor).attr('href')),
        });
      });
      const category = /^NHL$/i.test(league) ? 'nhl' : region === 'INT' || /olympic|world championship|iihf|international/i.test(league) ? 'international' : 'other';
      const id = createHash('sha256').update(`${league}|${title}|${utcTime}`).digest('hex').slice(0, 16);
      games.push({ id, league, region, title, utcTime, category, sources });
    });
  });
  return games;
}
module.exports = { ORIGIN, publicUrl, resolveSource, parseSchedule };
