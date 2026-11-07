"""Local syntax inspection only. Never opens a database connection.
Requires pglast; reports no financial PASS results.
"""
from pathlib import Path
from pglast import parse_sql, parse_plpgsql

proposal = Path(__file__).with_name('migration-b-review.sql').read_text()
print(f'Outer SQL statements parsed: {len(parse_sql(proposal))}')
print(f'PL/pgSQL definitions parsed: {len(parse_plpgsql(proposal))}')
print('Syntax inspection only; database execution and all 12 financial tests: PENDENTE.')
