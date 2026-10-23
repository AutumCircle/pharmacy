import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mirrorQuantity,
  mirrorSearchError,
  validMirrorProducts,
  validMirrorDetail,
  validMirrorStatus,
  mirrorMoney,
  mirrorPriceRange,
} from '../src/lib/pharmacy-mirror.ts';
import { oracleFieldLabel, oracleFieldValue } from '../src/lib/pharmacy-mirror-fields.ts';
import { mirrorHelp, oracleFieldHelpTopic } from '../src/lib/pharmacy-mirror-help.ts';

test('search validates short names and permits a one digit exact ID', () => {
  assert.match(mirrorSearchError('a', 'name'), /минимум 2/);
  assert.equal(mirrorSearchError('1', 'auto'), '');
  assert.match(mirrorSearchError('1 OR true', 'id'), /цифры/);
  assert.equal(mirrorSearchError('a%_', 'name'), '');
});
test('missing stock is not displayed as zero and corrupt totals are explicit', () => {
  assert.equal(mirrorQuantity(null, 0, 0), 'Нет данных об остатке в зеркале');
  assert.equal(mirrorQuantity('0', 3, 0), '0');
  assert.equal(mirrorQuantity('0.5', 3, 0), '0.5');
  assert.equal(mirrorQuantity('7', 3, 1), 'Есть некорректные значения');
});

test('money keeps decimal precision, distinguishes zero from missing, and displays ranges', () => {
  assert.equal(mirrorMoney(null), 'Нет данных');
  assert.equal(mirrorMoney('0'), '0,00 с.');
  assert.equal(mirrorMoney('1234.5'), '1 234,50 с.');
  assert.equal(mirrorMoney('9007199254740993.1234'), '9 007 199 254 740 993,1234 с.');
  assert.equal(mirrorMoney('not a price'), 'Нет данных');
  assert.equal(mirrorPriceRange('5', '7.5'), '5,00 с. — 7,50 с.');
  assert.equal(mirrorPriceRange(null, '7'), 'Нет данных');
  assert.equal(mirrorPriceRange('7.0', '7.00'), '7,00 с.');
});

test('all Oracle values have readable labels and zero/false remain visible', () => {
  assert.equal(oracleFieldLabel('PRODUCT_ID'), 'ID товара в «Алгоритме»');
  assert.match(oracleFieldLabel('INCOME_ID'), /партии/);
  assert.equal(oracleFieldValue(0), '0');
  assert.equal(oracleFieldValue(false), 'Нет');
  assert.equal(oracleFieldValue(null), 'Не заполнено');
  assert.equal(oracleFieldValue('000123'), '000123');
});
test('contracts reject unbounded sets and malformed row data', () => {
  assert.equal(validMirrorProducts({ items: [], total: 0, page: 1, limit: 25 }), true);
  assert.equal(validMirrorProducts({ items: [], total: 0, page: 1, limit: 100 }), false);
  assert.equal(
    validMirrorProducts({ items: Array(26).fill({}), total: 26, page: 1, limit: 25 }),
    false,
  );
  assert.equal(validMirrorProducts({ items: [], total: -1, page: 1, limit: 25 }), false);
  assert.equal(validMirrorDetail({ product: { oracle: 'private' } }), false);
  assert.equal(validMirrorStatus({ tables: [] }), false);
});

test('help distinguishes product/receipt IDs, arrival dates, and missing versus zero stock', () => {
  assert.equal(oracleFieldHelpTopic('PRODUCT_ID'), 'productId');
  assert.equal(oracleFieldHelpTopic('INCOME_ID'), 'receiptId');
  assert.equal(oracleFieldHelpTopic('INCOME_DATE_OLD'), 'sourceDate');
  assert.match(mirrorHelp.productId.text, /PRODUCT_ID/);
  assert.match(mirrorHelp.receiptId.text, /не дата, не количество/);
  assert.match(mirrorHelp.stock.text, /не подтверждённый ноль/);
  assert.match(mirrorHelp.history.text, /Отрицательные или некорректные/);
  assert.match(mirrorHelp.received.text, /не дата покупки, продажи/);
});
