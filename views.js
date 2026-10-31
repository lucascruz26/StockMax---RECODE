// StockMax — funções que geram o HTML no servidor (sem arquivos .html, sem JavaScript no navegador).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dt = v => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—';
const KINDS = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste' };
const status = p => !p.is_active ? 'Inativo' : p.qty === 0 ? 'Esgotado' : p.qty <= p.min_qty ? 'Crítico' : 'OK';
const csrf = req => `<input type="hidden" name="_csrf" value="${req.session.csrf}">`;
const field = (label, name, a = {}) => `<label>${label}<input name="${name}" ${Object.entries(a).filter(([, v]) => v != null && v !== false).map(([k, v]) => v === true ? k : `${k}="${esc(v)}"`).join(' ')}></label>`;
const table = (heads, rows) => rows.length ? `<figure><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></figure>` : '';

function page(req, title, body) {
  const msgs = (req.session.flash || []).map(m => `<p><mark>${esc(m)}</mark></p>`).join(''), u = req.user;
  req.session.flash = null;
  const nav = u ? `<details><summary>☰ StockMax — ${esc(u.name)} (${u.role})</summary><ul>
    <li><a href="/">Painel</a></li><li><a href="/produtos">Produtos</a></li><li><a href="/movimentacoes">Movimentações</a></li><li><a href="/fornecedores">Fornecedores</a></li>
    <li><form method="post" action="/sair">${csrf(req)}<button>Sair</button></form></li></ul></details>` : '<h1>StockMax</h1>';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} • StockMax</title><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2.0.6/css/pico.classless.yellow.min.css"></head>
<body><header>${nav}</header><main>${msgs}${body}</main></body></html>`;
}
module.exports = { esc, brl, dt, KINDS, status, csrf, field, table, page };
