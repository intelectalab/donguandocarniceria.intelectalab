/* =====================================================================
   Mapa esquemático (SVG, sin teselas externas) de las zonas de reparto
   de Lima: pines de direcciones, locales, rutas y selección de pin.
   G.ui.map({ points:[{lat,lng,label,tone,title,onClick}], routes:[{points:[[lat,lng],…], tone, label}],
              zones:true, sites:true, height:320, onPick:(lat,lng,zone)=>{}, pick:{lat,lng}, bounds:{latMin,latMax,lngMin,lngMax} })
   G.geo.zoneAt(lat,lng) → zona de reparto que contiene el punto (o la más cercana a 3 km)
   G.geo.km(a,b) → distancia en km entre [lat,lng]
   ===================================================================== */
(function () {
  const h = G.ui.h;
  G.geo = {
    km(a, b) { const R = 6371, dLat = (b[0] - a[0]) * Math.PI / 180, dLng = (b[1] - a[1]) * Math.PI / 180; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); },
    inPoly(lat, lng, poly) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j]; if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) ins = !ins; } return ins; },
    zoneAt(lat, lng) {
      const zs = G.db.where('delivery_zones', z => !z.province && z.status === 'ACTIVE' && z.polygon);
      const hit = zs.filter(z => G.geo.inPoly(lat, lng, z.polygon)).sort((a, b) => a.priority - b.priority)[0];
      if (hit) return hit;
      let best = null, bd = 1e9; for (const z of zs) { const d = G.geo.km([lat, lng], [z.lat, z.lng]); if (d < bd) { bd = d; best = z; } }
      return bd <= 3 ? best : null;
    },
    /** distancia de una ruta en km (factor de calles 1,35 sobre la línea recta) */
    routeKm(points) { let k = 0; for (let i = 1; i < points.length; i++) k += G.geo.km(points[i - 1], points[i]); return G.util.round(k * 1.35, 1); },
  };
  G.ui.map = function (o = {}) {
    const W = 640, H = o.height || 320;
    const zones = G.db.where('delivery_zones', z => !z.province && z.polygon);
    const b = o.bounds || { latMin: -12.30, latMax: -12.04, lngMin: -77.07, lngMax: -76.84 };
    const X = lng => (lng - b.lngMin) / (b.lngMax - b.lngMin) * W;
    const Y = lat => (b.latMax - lat) / (b.latMax - b.latMin) * H;
    const ns = 'http://www.w3.org/2000/svg';
    const el = (t, a, txt) => { const e = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a || {})) e.setAttribute(k, v); if (txt != null) e.textContent = txt; return e; };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gmap', role: 'img', 'aria-label': o.label || 'Mapa de zonas de reparto' });
    svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, class: 'gmap-bg' }));
    // costa (referencial)
    svg.appendChild(el('path', { d: `M ${X(-77.07)} ${Y(-12.06)} L ${X(-77.045)} ${Y(-12.11)} L ${X(-77.03)} ${Y(-12.15)} L ${X(-77.0)} ${Y(-12.19)} L ${X(-76.95)} ${Y(-12.24)} L ${X(-76.90)} ${Y(-12.30)} L 0 ${H} Z`, class: 'gmap-sea' }));
    if (o.zones !== false) for (const z of zones) {
      const pts = z.polygon.map(([la, ln]) => `${X(ln)},${Y(la)}`).join(' ');
      const g = el('g', { class: 'gmap-zone' + (o.highlightZone === z.id ? ' hl' : '') });
      g.appendChild(el('polygon', { points: pts }));
      g.appendChild(el('text', { x: X(z.lng), y: Y(z.lat) + 3, 'text-anchor': 'middle' }, z.code));
      svg.appendChild(g);
    }
    for (const r of o.routes || []) {
      if (!r.points || r.points.length < 2) continue;
      svg.appendChild(el('polyline', { points: r.points.map(([la, ln]) => `${X(ln)},${Y(la)}`).join(' '), class: 'gmap-route ' + (r.tone || '') }));
    }
    if (o.sites !== false) for (const s of G.db.all('establishments').filter(e => e.lat)) {
      const g = el('g', { class: 'gmap-site' });
      g.appendChild(el('rect', { x: X(s.lng) - 7, y: Y(s.lat) - 7, width: 14, height: 14, rx: 3 }));
      g.appendChild(el('text', { x: X(s.lng) + 10, y: Y(s.lat) + 4 }, s.code));
      svg.appendChild(g);
    }
    (o.points || []).forEach((p, i) => {
      if (p.lat == null) return;
      const g = el('g', { class: 'gmap-pin ' + (p.tone || ''), tabindex: p.onClick ? 0 : null });
      g.appendChild(el('circle', { cx: X(p.lng), cy: Y(p.lat), r: p.r || 6 }));
      if (p.label != null) g.appendChild(el('text', { x: X(p.lng), y: Y(p.lat) + 3, 'text-anchor': 'middle', class: 'gmap-pin-label' }, String(p.label)));
      if (p.title) g.appendChild(el('title', null, p.title));
      if (p.onClick) { g.style.cursor = 'pointer'; g.addEventListener('click', e => { e.stopPropagation(); p.onClick(p); }); }
      svg.appendChild(g);
    });
    let pickMark = null;
    const drawPick = (lat, lng) => { if (pickMark) pickMark.remove(); pickMark = el('g', { class: 'gmap-pick' }); pickMark.appendChild(el('path', { d: `M ${X(lng)} ${Y(lat)} l -7 -16 a 8 8 0 1 1 14 0 z` })); svg.appendChild(pickMark); };
    if (o.pick && o.pick.lat != null) drawPick(o.pick.lat, o.pick.lng);
    if (o.onPick) {
      svg.style.cursor = 'crosshair';
      svg.addEventListener('click', e => {
        const r = svg.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
        const lng = G.util.round(b.lngMin + x / W * (b.lngMax - b.lngMin), 6), lat = G.util.round(b.latMax - y / H * (b.latMax - b.latMin), 6);
        drawPick(lat, lng); o.onPick(lat, lng, G.geo.zoneAt(lat, lng));
      });
    }
    const wrap = h('div', { class: 'gmap-wrap' }, svg);
    if (o.legend) wrap.appendChild(h('div', { class: 'gmap-legend small muted' }, o.legend));
    return wrap;
  };
})();
