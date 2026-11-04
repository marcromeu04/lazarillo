// Panel de interés al colgar: KPIs de la sesión y el acumulado de todas las sesiones.
// Una sola serie (interés por página) → barras horizontales de un color, etiqueta directa y
// detalle al pasar el ratón. Las frases del visitante van como citas, en color de texto.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round((s || 0) % 60)).padStart(2, '0')}`;

let root = null;
let lastReport = null;

function ensure() {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'dash';
  root.className = 'dash';
  root.hidden = true;
  root.innerHTML = `
    <div class="dcard" role="dialog" aria-modal="true" aria-labelledby="dtitle">
      <div class="dhead">
        <div><div class="dkicker">Informe de interés</div><div class="dtitle" id="dtitle">Esta sesión</div></div>
        <div class="dtabs" role="tablist">
          <button role="tab" data-tab="sesion" aria-selected="true">Esta sesión</button>
          <button role="tab" data-tab="todas" aria-selected="false">Todas las sesiones</button>
        </div>
        <button class="dclose" aria-label="Cerrar">×</button>
      </div>
      <div class="dbody" id="dbody"></div>
    </div>
    <div class="dtip" id="dtip" hidden></div>`;
  document.body.appendChild(root);
  root.querySelector('.dclose').onclick = () => (root.hidden = true);
  root.addEventListener('click', (e) => { if (e.target === root) root.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') root.hidden = true; });
  root.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));
  return root;
}

function tile(label, value, sub = '') {
  return `<div class="dtile"><div class="dlabel">${esc(label)}</div><div class="dvalue">${esc(value)}</div>${sub ? `<div class="dsub">${esc(sub)}</div>` : ''}</div>`;
}

// Barras horizontales: etiqueta de la página a la izquierda, valor al final, detalle en hover.
function bars(rows, valueKey, detail) {
  if (!rows.length) return '<div class="dempty">Sin páginas visitadas todavía.</div>';
  const max = Math.max(100, ...rows.map((r) => r[valueKey] || 0));
  return `<div class="dbars">${rows
    .map((r, i) => {
      const v = r[valueKey] || 0;
      return `<div class="dbar" data-i="${i}"><div class="dbl" title="${esc(r.title)}">${esc(r.title)}</div><div class="dtrack"><div class="dfill" style="width:${Math.max(1.5, (v / max) * 100)}%"></div></div><div class="dbv">${Number(v)}</div></div>`;
    })
    .join('')}</div>`;
  void detail;
}

function wireTips(container, rows, detail) {
  const tip = root.querySelector('#dtip');
  container.querySelectorAll('.dbar').forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      const r = rows[Number(el.dataset.i)];
      tip.innerHTML = detail(r);
      tip.hidden = false;
      tip.style.left = Math.min(window.innerWidth - 260, e.clientX + 14) + 'px';
      tip.style.top = e.clientY + 14 + 'px';
    });
    el.addEventListener('mouseleave', () => (tip.hidden = true));
  });
}

function quotes(list, empty) {
  if (!list || !list.length) return `<div class="dempty">${esc(empty)}</div>`;
  return `<ul class="dquotes">${list.map((q) => `<li>«${esc(typeof q === 'string' ? q : q.frase)}»${q.veces ? ` <span class="dsub">×${Number(q.veces)}</span>` : ''}</li>`).join('')}</ul>`;
}

function nextStep(r) {
  const top = (r.paginas || [])[0];
  const page = top ? `«${top.title}»` : 'lo que más le interesó';
  if ((r.señalesCompra || []).length) return `Seguimiento comercial en 24 h: ha preguntado «${r.señalesCompra[0]}». Centra la llamada en ${page}.`;
  if ((r.pain || []).length) return `Envíale un caso de uso de ${page} que responda a: «${r.pain[0]}».`;
  if (top && top.interes >= 50) return `Envíale material de ${page}: es donde más tiempo pasó y más preguntó.`;
  return 'Interés bajo: nútrelo con contenido general y vuelve a intentarlo más adelante.';
}

function renderSession(r) {
  const body = root.querySelector('#dbody');
  if (!r || !r.paginas) {
    body.innerHTML = '<div class="dempty">Todavía no hay ninguna llamada analizada. Haz una demo y cuelga para ver el informe.</div>';
    return;
  }
  const pages = r.paginas || [];
  const top = pages[0];
  const preguntas = pages.reduce((a, p) => a + (p.preguntas || 0), 0);
  const perfil = Object.entries(r.perfil || {}).flatMap(([k, v]) => v.map((x) => `${k}: ${x}`));
  body.innerHTML = `
    <div class="dtiles">
      ${tile('Duración', mmss(r.duracionSeg))}
      ${tile('Páginas vistas', pages.length)}
      ${tile('Preguntas', preguntas)}
      ${tile('Señales de compra', (r.señalesCompra || []).length)}
      ${tile('Interés máximo', top ? top.interes : '—', top ? top.title : '')}
    </div>
    <p class="dresumen">${esc(r.resumen || '')}</p>
    <div class="dgrid">
      <section><h3>Interés por página <span class="dsub">0-100 · tiempo, preguntas y lo que dijo</span></h3><div id="dpages">${bars(pages.slice(0, 8), 'interes')}</div></section>
      <section>
        <h3>Problema que quiere resolver</h3>${quotes(r.pain, 'No ha contado un problema concreto.')}
        <h3>Señales de compra</h3>${quotes(r.señalesCompra, 'Sin preguntas de precio, prueba o integración.')}
        <h3>Perfil</h3>${perfil.length ? `<div class="dchips">${perfil.map((p) => `<span>${esc(p)}</span>`).join('')}</div>` : '<div class="dempty">Sin datos de perfil.</div>'}
        <div class="dnext"><b>Siguiente paso recomendado</b><br>${esc(nextStep(r))}</div>
      </section>
    </div>`;
  wireTips(body.querySelector('#dpages'), pages.slice(0, 8), (p) => `<b>${esc(p.title)}</b><br>Interés ${Number(p.interes)} · ${mmss(p.segundos)} · ${Number(p.preguntas)} preguntas · ${Number(p.visitas)} visita(s)${(p.temas || []).length ? `<br><span class="dsub">Temas: ${esc(p.temas.join(', '))}</span>` : ''}`);
}

async function renderAll() {
  const body = root.querySelector('#dbody');
  body.innerHTML = '<div class="dempty">Cargando…</div>';
  const a = await fetch('/api/insights/todas').then((x) => x.json()).catch(() => null);
  if (!a || !a.sesiones) {
    body.innerHTML = '<div class="dempty">Aún no hay sesiones guardadas para esta web.</div>';
    return;
  }
  const pages = a.paginas || [];
  body.innerHTML = `
    <div class="dtiles">
      ${tile('Sesiones', a.sesiones, a.web || '')}
      ${tile('Página con más interés', pages[0] ? pages[0].interesMedio : '—', pages[0] ? pages[0].title : '')}
      ${tile('Problemas detectados', (a.painFrecuentes || []).length)}
      ${tile('Señales de compra', (a.señalesCompra || []).length)}
    </div>
    <div class="dgrid">
      <section><h3>Interés medio por página <span class="dsub">media de todas las sesiones</span></h3><div id="dall">${bars(pages.slice(0, 10), 'interesMedio')}</div></section>
      <section>
        <h3>Problemas que más se repiten</h3>${quotes(a.painFrecuentes, 'Ningún problema repetido todavía.')}
        <h3>Señales de compra más frecuentes</h3>${quotes(a.señalesCompra, 'Sin señales de compra todavía.')}
      </section>
    </div>`;
  wireTips(body.querySelector('#dall'), pages.slice(0, 10), (p) => `<b>${esc(p.title)}</b><br>Interés medio ${Number(p.interesMedio)} · ${Number(p.sesiones)} sesión(es) · ${mmss(p.segundosMedios)} de media`);
}

function openTab(tab) {
  ensure();
  root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  root.querySelector('#dtitle').textContent = tab === 'todas' ? 'Todas las sesiones' : 'Esta sesión';
  if (tab === 'todas') renderAll();
  else renderSession(lastReport);
}

/** Abre el panel. Sin informe, enseña el último que haya (o el acumulado). */
export async function showDashboard(report) {
  ensure();
  if (report) lastReport = report;
  if (!lastReport) {
    const r = await fetch('/api/insights').then((x) => x.json()).catch(() => null);
    if (r && r.paginas) { const { transcripcion, ...rest } = r; lastReport = rest; void transcripcion; }
  }
  root.hidden = false;
  openTab(lastReport ? 'sesion' : 'todas');
}
