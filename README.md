# StockMax (Node.js + SQL)

Controle de estoque feito somente com **JavaScript (Node.js, no servidor)** e **SQL (PostgreSQL / Neon)**. Não há arquivos `.html` ou `.css` no projeto: o servidor gera as páginas em JavaScript (`views.js`) e o navegador não executa nenhum JavaScript. O visual vem de uma folha de estilo pronta (Pico, tema amarelo) carregada por link. Funciona em computador e celular.

## Estrutura
```
server.js        Rotas, regras de negócio e consultas SQL (módulo pg)
views.js         Funções que geram o HTML no servidor
db/schema.sql    Tabelas, restrições, índice, gatilho de auditoria e view (SQL)
db/seed.js       Dados de demonstração (opcional)
package.json     Dependências e scripts
.env.example     Variáveis de ambiente
```

## Banco de dados (SQL)
- `users`, `suppliers`, `products`, `movements`, com `CHECK`, chaves estrangeiras e índice.
- **Auditoria inviolável:** um *trigger* impede `UPDATE` e `DELETE` em `movements`.
- **Soft delete:** produtos usam `is_active = false`; nada é apagado.
- **Motivo obrigatório:** a própria tabela rejeita movimentação sem motivo.
- `v_estoque_alerta`: view com os produtos no mínimo ou abaixo, usada no painel.
- Saldo e movimentação são gravados na mesma **transação** (`BEGIN ... FOR UPDATE ... COMMIT`).

## Como rodar
Pré-requisitos: Node.js 18+ e um PostgreSQL (recomendado: Neon, botão **Connect** → string *pooled*).
```bash
npm install
cp .env.example .env      # preencha DATABASE_URL e SECRET_KEY
npm start                 # cria as tabelas sozinho e abre em http://localhost:3000
npm run seed              # opcional: dados e contas de demonstração (veja db/seed.js)
```
Sem o `seed`, o banco começa **zerado**. A primeira conta criada em "Criar conta nova" vira **Admin**; as seguintes, **Operador**.

## Publicar
O GitHub Pages não executa Node.js. Guarde o código no GitHub e hospede em um serviço que rode Node (Render, Railway, Fly.io):
- Build: `npm install` · Start: `npm start`
- Variáveis: `DATABASE_URL`, `SECRET_KEY` e `COOKIE_SECURE=1`

Nunca envie o `.env` ao GitHub (já está no `.gitignore`).
