require('dotenv').config();
const fetch = require('node-fetch');

async function checkAirtableStructure() {
  try {
    console.log('Проверяем структуру таблицы People...\n');
    
    // Получаем первую запись чтобы увидеть поля
    const response = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/People?maxRecords=1`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`
        }
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      console.log('Ошибка:', error);
      return;
    }
    
    const data = await response.json();
    
    if (data.records.length === 0) {
      console.log('Таблица пуста. Добавьте хотя бы одну запись в Airtable для проверки структуры.');
      return;
    }
    
    console.log('Найденные поля в таблице:\n');
    const fields = data.records[0].fields;
    
    Object.keys(fields).forEach(fieldName => {
      const value = fields[fieldName];
      const type = Array.isArray(value) ? 'Array' : typeof value;
      console.log(`- "${fieldName}" (тип: ${type})`);
    });
    
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

checkAirtableStructure();