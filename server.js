// StockMax — servidor (Node.js + Express + PostgreSQL com SQL puro). Sem JavaScript no navegador.
require('dotenv').config();
const fs = require('fs'), path = require('path'), crypto = require('crypto'), express = require('express'),
  cookieSession = require('cookie-session'), bcrypt = require('bcryptjs'), { Pool } = require('pg');
const { esc, brl, dt, KINDS, status, csrf, field, table, page } = require('./views');

if (!process.env.DATABASE_URL) { console.error('Defina DATABASE_URL no arquivo .env (veja .env.example).'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL }), q = (t, p) => pool.query(t, p);
class Erro extends Error {}
const flash = (req, m) => { req.session.flash = [...(req.session.flash || []), m]; };
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const send = (req, res, title, body, code = 200) => res.status(code).send(page(req, title, body));
const MOVES = 'SELECT m.*, p.name AS product, u.name AS username FROM movements m JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.user_id';
const movesTable = rows => table(['Data', 'Produto', 'Tipo', 'Qtd.', 'Usuário', 'Motivo'],
  rows.map(m => [dt(m.created_at), esc(m.product), KINDS[m.kind], m.qty, esc(m.username), esc(m.reason)])) || '<p>Nenhuma movimentação encontrada.</p>';

const app = express();
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(cookieSession({ name: 'sm', secret: [process.env.SECRET_KEY || 'dev-troque-esta-chave'], httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 8 * 3600e3 }));
app.use(h(async (req, res, next) => {
  req.session.csrf ??= crypto.randomBytes(16).toString('hex');
  if (req.method === 'POST' && req.body._csrf !== req.session.csrf) return res.status(400).send('Requisição inválida (CSRF).');
  req.user = req.session.uid ? (await q('SELECT id, name, role FROM users WHERE id = $1', [req.session.uid])).rows[0] : null;
  next();
}));
const need = role => (req, res, next) => !req.user ? res.redirect('/login')
  : role && req.user.role !== role ? send(req, res, 'Acesso negado', '<p><mark>Apenas o perfil Admin faz esta ação.</mark></p>', 403) : next();

/* ---------- autenticação ---------- */
const authPage = (req, res, reg) => send(req, res, reg ? 'Criar conta' : 'Entrar', `<h2>${reg ? 'Criar conta' : 'Entrar'}</h2><p>Controle de estoque simples e seguro.</p>
  <form method="post">${csrf(req)}${reg ? field('Nome', 'name', { required: true, autocomplete: 'name' }) : ''}
  ${field('E-mail', 'email', { type: 'email', required: true, autocomplete: 'email' })}
  ${field('Senha', 'password', { type: 'password', required: true, minlength: reg ? 6 : 1, autocomplete: reg ? 'new-password' : 'current-password' })}
  <button>${reg ? 'Criar conta' : 'Entrar'}</button></form><p><a href="${reg ? '/login' : '/cadastro'}">${reg ? 'Já tenho conta' : 'Criar conta nova'}</a></p>`);
app.get('/login', (req, res) => authPage(req, res, false));
app.get('/cadastro', (req, res) => authPage(req, res, true));
app.post('/login', h(async (req, res) => {
  const u = (await q('SELECT * FROM users WHERE email = $1', [(req.body.email || '').trim().toLowerCase()])).rows[0];
  if (u && await bcrypt.compare(req.body.password || '', u.password_hash)) {
    await q('UPDATE users SET last_login = now() WHERE id = $1', [u.id]);
    req.session = { uid: u.id, csrf: crypto.randomBytes(16).toString('hex') };
    return res.redirect('/');
  }
  flash(req, 'E-mail ou senha inválidos.'); res.redirect('/login');
}));
app.post('/cadastro', h(async (req, res) => {
  const { name = '', email = '', password = '' } = req.body, e = email.trim().toLowerCase();
  if (!name.trim() || !e.includes('@') || password.length < 6) { flash(req, 'Informe nome, e-mail válido e senha com no mínimo 6 caracteres.'); return res.redirect('/cadastro'); }
  try {  // a primeira conta vira Admin; as demais, Operador
    await q(`INSERT INTO users(name, email, password_hash, role) VALUES($1, $2, $3, CASE WHEN EXISTS (SELECT 1 FROM users) THEN 'Operador' ELSE 'Admin' END)`, [name.trim(), e, await bcrypt.hash(password, 10)]);
    flash(req, 'Conta criada. Faça login.'); res.redirect('/login');
  } catch (x) { if (x.code !== '23505') throw x; flash(req, 'Este e-mail já está cadastrado.'); res.redirect('/cadastro'); }
}));
app.post('/sair', (req, res) => { req.session = null; res.redirect('/login'); });

/* ---------- painel ---------- */
app.get('/', need(), h(async (req, res) => {
  const [{ rows: [k] }, { rows: al }, { rows: mv }] = await Promise.all([
    q(`SELECT COALESCE(SUM(qty * cost), 0) AS capital, COUNT(*) FILTER (WHERE qty = 0) AS esgotados,
       COUNT(*) FILTER (WHERE qty > 0 AND qty <= min_qty) AS criticos FROM products WHERE is_active`),
    q('SELECT * FROM v_estoque_alerta ORDER BY qty, name'), q(MOVES + ' ORDER BY m.id DESC LIMIT 8')]);
  send(req, res, 'Painel', `<h1>Painel</h1>
    <article><header>Capital investido</header><h2>${brl(k.capital)}</h2></article>
    <article><header>Estoque crítico</header><h2>${k.criticos} produtos</h2></article>
    <article><header>Esgotados</header><h2>${k.esgotados} produtos</h2></article>
    <h2>Produtos em alerta</h2>${table(['Produto', 'Status', 'Qtd.', 'Mín.', ''], al.map(p => [`${esc(p.name)}<br><small>${esc(p.sku)}</small>`,
      `<mark>${status(p)}</mark>`, p.qty, p.min_qty, `<a href="/movimentacoes?repor=${p.id}">Repor</a>`])) || '<p>Nenhum produto em alerta.</p>'}
    <h2>Últimas movimentações</h2>${movesTable(mv)}`);
}));

/* ---------- produtos ---------- */
app.get('/produtos', need(), h(async (req, res) => {
  const s = (req.query.q || '').trim(), ina = !!req.query.inativos, adm = req.user.role === 'Admin';
  const { rows } = await q(`SELECT p.*, s.name AS supplier FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE ($1 OR p.is_active) AND ($2 = '' OR p.name ILIKE $3 OR p.sku ILIKE $3 OR p.category ILIKE $3) ORDER BY p.name`, [ina, s, `%${s}%`]);
  send(req, res, 'Produtos', `<h1>Produtos</h1>${adm ? '<p><a href="/produtos/novo" role="button">+ Novo produto</a></p>' : '<p><small>Somente Admin cria, edita e desativa produtos.</small></p>'}
    <form method="get"><input type="search" name="q" value="${esc(s)}" placeholder="Buscar por nome, SKU ou categoria">
    <label><input type="checkbox" name="inativos" value="1" ${ina ? 'checked' : ''}> Mostrar inativos</label><button>Buscar</button></form>
    ${table(['Produto', 'Fornecedor', 'Qtd.', 'Mín.', 'Custo', 'Status', ''], rows.map(p => [`${esc(p.name)}<br><small>${esc(p.sku)}${p.category ? ' · ' + esc(p.category) : ''}</small>`,
      esc(p.supplier || '—'), `${p.qty} ${esc(p.unit)}`, p.min_qty, brl(p.cost), status(p) === 'OK' ? 'OK' : `<mark>${status(p)}</mark>`,
      adm ? `<a href="/produtos/${p.id}/editar">Editar</a><form method="post" action="/produtos/${p.id}/alternar">${csrf(req)}<button class="secondary">${p.is_active ? 'Desativar' : 'Ativar'}</button></form>` : ''])) || '<p>Nenhum produto cadastrado ainda.</p>'}`);
}));

async function prodForm(req, res) {
  const id = +req.params.id || null;
  let p = id ? (await q('SELECT * FROM products WHERE id = $1', [id])).rows[0] : {};
  if (id && !p) return res.redirect('/produtos');
  if (req.method === 'POST') {
    const b = req.body, v = [(b.sku || '').trim().toUpperCase(), (b.name || '').trim(), (b.description || '').trim(), (b.category || '').trim(), (b.unit || '').trim() || 'un', +b.cost || 0, +b.price || 0, parseInt(b.min_qty) || 0, +b.supplier_id || null];
    try {
      if (!v[0] || !v[1]) throw new Erro('SKU e nome são obrigatórios.');
      if (v[5] < 0 || v[6] < 0 || v[7] < 0) throw new Erro('Valores não podem ser negativos.');
      await q(id ? 'UPDATE products SET sku=$1, name=$2, description=$3, category=$4, unit=$5, cost=$6, price=$7, min_qty=$8, supplier_id=$9 WHERE id=$10'
        : 'INSERT INTO products(sku, name, description, category, unit, cost, price, min_qty, supplier_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', id ? [...v, id] : v);
      flash(req, 'Produto salvo.'); return res.redirect('/produtos');
    } catch (e) {
      if (e instanceof Erro) flash(req, e.message); else if (e.code === '23505') flash(req, 'Já existe um produto com este SKU.'); else throw e;
      p = { ...p, ...b };
    }
  }
  const { rows: sup } = await q('SELECT id, name FROM suppliers ORDER BY name');
  send(req, res, id ? 'Editar produto' : 'Novo produto', `<h1>${id ? 'Editar' : 'Novo'} produto</h1><form method="post">${csrf(req)}
    ${field('SKU', 'sku', { value: p.sku, required: true, maxlength: 50 })}${field('Nome', 'name', { value: p.name, required: true, maxlength: 150 })}
    <label>Descrição<textarea name="description">${esc(p.description)}</textarea></label>${field('Categoria', 'category', { value: p.category, maxlength: 80 })}
    ${field('Unidade de medida', 'unit', { value: p.unit || 'un', maxlength: 10 })}${field('Preço de custo (R$)', 'cost', { type: 'number', step: '0.01', min: 0, value: p.cost })}
    ${field('Preço de venda (R$)', 'price', { type: 'number', step: '0.01', min: 0, value: p.price })}${field('Estoque mínimo', 'min_qty', { type: 'number', min: 0, value: p.min_qty || 0 })}
    <label>Fornecedor<select name="supplier_id"><option value="">— nenhum —</option>${sup.map(s => `<option value="${s.id}" ${s.id == p.supplier_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <button>Salvar</button></form><p><a href="/produtos">Voltar</a>${id ? '' : ' · O saldo inicial é lançado como "Entrada" em Movimentações.'}</p>`);
}
for (const m of ['get', 'post']) app[m](['/produtos/novo', '/produtos/:id/editar'], need('Admin'), h(prodForm));
app.post('/produtos/:id/alternar', need('Admin'), h(async (req, res) => {  // soft delete: nada é apagado fisicamente
  const { rows: [p] } = await q('UPDATE products SET is_active = NOT is_active WHERE id = $1 RETURNING is_active', [+req.params.id]);
  flash(req, p && p.is_active ? 'Produto reativado.' : 'Produto desativado (is_active = false).'); res.redirect('/produtos?inativos=1');
}));

/* ---------- movimentações ---------- */
async function move(pid, kind, qty, reason, uid) {  // saldo + registro na MESMA transação, com trava de linha
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const p = (await c.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [pid])).rows[0];
    reason = (reason || '').trim();
    if (!p || !p.is_active) throw new Erro('Produto inválido ou inativo.');
    if (!reason) throw new Erro('O motivo é obrigatório em toda movimentação.');
    let n = p.qty;
    if (kind === 'entrada') n += qty;
    else if (kind === 'saida') { if (qty > p.qty) throw new Erro(`Saldo insuficiente: há ${p.qty} em estoque.`); n -= qty; }
    else if (kind === 'ajuste') n = qty;
    else throw new Erro('Tipo de movimentação inválido.');
    await c.query('UPDATE products SET qty = $2 WHERE id = $1', [pid, n]);
    await c.query('INSERT INTO movements(product_id, user_id, kind, qty, reason) VALUES($1,$2,$3,$4,$5)', [pid, uid, kind, qty, reason]);
    await c.query('COMMIT');
    return { ...p, qty: n };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
app.post('/movimentacoes', need(), h(async (req, res) => {
  const { product_id, kind, qty, reason } = req.body, n = parseInt(qty);
  try {
    if (!(n >= 0) || (n === 0 && kind !== 'ajuste')) throw new Erro('Informe uma quantidade válida.');
    const p = await move(+product_id, kind, n, reason, req.user.id);
    flash(req, `Movimentação registrada. Saldo de ${p.name}: ${p.qty}.` + (p.qty <= p.min_qty ? ' ATENÇÃO: estoque no mínimo ou abaixo!' : ''));
  } catch (e) { if (!(e instanceof Erro)) throw e; flash(req, e.message); }
  res.redirect('/movimentacoes');
}));
app.get('/movimentacoes', need(), h(async (req, res) => {
  const { tipo, produto, usuario, de, ate, repor } = req.query, w = [], p = [], date = /^\d{4}-\d{2}-\d{2}$/;
  const add = (sql, v) => { p.push(v); w.push(sql.replace('?', '$' + p.length)); };
  if (KINDS[tipo]) add('m.kind = ?', tipo);
  if (+produto) add('m.product_id = ?', +produto);
  if (+usuario) add('m.user_id = ?', +usuario);
  if (date.test(de || '')) add('m.created_at >= ?', de);
  if (date.test(ate || '')) add('m.created_at < (?::date + 1)', ate);
  const [mv, ap, us] = (await Promise.all([q(MOVES + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY m.id DESC LIMIT 200', p),
    q('SELECT id, name, qty, is_active FROM products ORDER BY name'), q('SELECT id, name FROM users ORDER BY name')])).map(r => r.rows);
  const opts = (rows, sel) => rows.map(r => `<option value="${r.id ?? r[0]}" ${String(r.id) === String(sel) ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const kinds = sel => Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
  send(req, res, 'Movimentações', `<h1>Movimentações</h1><details ${repor ? 'open' : ''}><summary>Registrar movimentação</summary><form method="post">${csrf(req)}
    <label>Produto<select name="product_id" required>${ap.filter(x => x.is_active).map(x => `<option value="${x.id}" ${String(x.id) === repor ? 'selected' : ''}>${esc(x.name)} (${x.qty} em estoque)</option>`).join('')}</select></label>
    <label>Tipo<select name="kind">${kinds()}</select></label>${field('Quantidade (em "Ajuste", informe o novo saldo)', 'qty', { type: 'number', min: 0, required: true })}
    ${field('Motivo (obrigatório)', 'reason', { required: true, maxlength: 255, placeholder: 'Ex.: compra NF 123, venda, avaria' })}<button>Registrar</button></form></details>
    <h2>Histórico (auditoria)</h2><form method="get"><label>Tipo<select name="tipo"><option value="">Todos</option>${kinds(tipo)}</select></label>
    <label>Produto<select name="produto"><option value="">Todos</option>${opts(ap, produto)}</select></label><label>Usuário<select name="usuario"><option value="">Todos</option>${opts(us, usuario)}</select></label>
    ${field('De', 'de', { type: 'date', value: de })}${field('Até', 'ate', { type: 'date', value: ate })}<button>Filtrar</button></form>
    <p><a href="/movimentacoes">Limpar filtros</a></p>${movesTable(mv)}`);
}));

/* ---------- fornecedores ---------- */
app.get('/fornecedores', need(), h(async (req, res) => {
  const { rows } = await q('SELECT * FROM suppliers ORDER BY name');
  send(req, res, 'Fornecedores', `<h1>Fornecedores</h1>${table(['Razão social', 'CNPJ/CPF', 'Telefone', 'E-mail'], rows.map(s => [esc(s.name), esc(s.doc || '—'), esc(s.phone || '—'), esc(s.email || '—')])) || '<p>Nenhum fornecedor cadastrado ainda.</p>'}
    ${req.user.role === 'Admin' ? `<details><summary>+ Novo fornecedor</summary><form method="post">${csrf(req)}${field('Razão social', 'name', { required: true, maxlength: 150 })}
    ${field('CNPJ/CPF', 'doc', { maxlength: 20 })}${field('Telefone', 'phone', { maxlength: 30 })}${field('E-mail', 'email', { type: 'email', maxlength: 150 })}<button>Salvar</button></form></details>` : ''}`);
}));
app.post('/fornecedores', need('Admin'), h(async (req, res) => {
  const b = req.body;
  if ((b.name || '').trim()) { await q('INSERT INTO suppliers(name, doc, phone, email) VALUES($1,$2,$3,$4)', [b.name.trim(), (b.doc || '').trim(), (b.phone || '').trim(), (b.email || '').trim()]); flash(req, 'Fornecedor cadastrado.'); }
  else flash(req, 'Informe a razão social.');
  res.redirect('/fornecedores');
}));

app.use((err, req, res, next) => { console.error(err); res.status(500).send('Erro interno. Tente novamente.'); });
q(fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8')).then(() => app.listen(process.env.PORT || 3000, () => console.log('StockMax em http://localhost:' + (process.env.PORT || 3000))))
  .catch(e => { console.error('Falha ao conectar/criar o banco:', e.message); process.exit(1); });
