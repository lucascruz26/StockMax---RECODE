// Dados de demonstração (opcional): npm run seed
require('dotenv').config();
const fs = require('fs'), path = require('path'), bcrypt = require('bcryptjs'), { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }), one = async (sql, p) => (await pool.query(sql, p)).rows[0];
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  if ((await pool.query("SELECT 1 FROM users WHERE email = 'admin@stockmax.com'")).rowCount) { console.log('A demonstração já existe.'); return pool.end(); }
  const user = async (n, e, pw, r) => (await one('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id', [n, e, await bcrypt.hash(pw, 10), r])).id;
  const admin = await user('Admin', 'admin@stockmax.com', 'admin123', 'Admin');
  await user('Operador', 'operador@stockmax.com', 'op123', 'Operador');
  const sup = [];
  for (const [n, d] of [['TechParts Ltda', '12.345.678/0001-90'], ['Distribuidora Alfa', '98.765.432/0001-10']])
    sup.push((await one('INSERT INTO suppliers(name,doc) VALUES($1,$2) RETURNING id', [n, d])).id);
  for (const [sku, n, s, qty, min, c] of [['TEC-001', 'Teclado Mecânico', 0, 24, 10, 180], ['MOU-002', 'Mouse Sem Fio', 0, 6, 10, 60], ['MON-003', 'Monitor 24 pol', 1, 0, 5, 620], ['HUB-005', 'Hub USB-C', 1, 4, 8, 75]]) {
    const p = await one('INSERT INTO products(sku,name,supplier_id,qty,min_qty,cost,price) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [sku, n, sup[s], qty, min, c, c * 2]);
    if (qty) await pool.query("INSERT INTO movements(product_id,user_id,kind,qty,reason) VALUES($1,$2,'entrada',$3,'Estoque inicial')", [p.id, admin, qty]);
  }
  console.log('Demonstração criada.'); await pool.end();
})();
