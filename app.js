const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Файл для хранения токенов
const TOKENS_FILE = path.join(__dirname, 'stored_tokens.json');

// Функция для загрузки сохраненных токенов
function loadStoredTokens() {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      const data = fs.readFileSync(TOKENS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading stored tokens:', error);
  }
  return null;
}

// Функция для сохранения токенов
function saveTokens(tokens, userInfo = null) {
  try {
    const data = {
      tokens,
      userInfo,
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2));
    console.log('Tokens saved successfully');
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

// Функция для получения валидного токена
async function getValidToken(req) {
  if (!req.session.tokens || !req.session.tokens.access_token) {
    throw new Error('No access token available');
  }
  return req.session.tokens.access_token;
}

// Настройка сессий
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 часа
  }
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware для восстановления токенов из файла
app.use((req, res, next) => {
  if (!req.session.tokens) {
    const storedData = loadStoredTokens();
    if (storedData) {
      req.session.tokens = storedData.tokens;
      req.session.userInfo = storedData.userInfo;
      console.log('Restored tokens from file');
    }
  }
  next();
});
// Функция для получения списка городов из API HeadHunter
async function getAreasFromHH() {
  try {
    const response = await fetch('https://api.hh.ru/areas', {
      headers: {
        'User-Agent': 'HH-Airtable-App/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch areas');
    }
    
    const areas = await response.json();
    
    // Создаем плоский список городов для удобства
    const flatAreas = [];
    
    // Функция для рекурсивного обхода дерева регионов
    function processArea(area, parentName = '') {
      // Добавляем текущий регион
      flatAreas.push({
        id: area.id,
        name: parentName ? `${area.name}, ${parentName}` : area.name,
        parentId: area.parent_id
      });
      
      // Обрабатываем дочерние регионы
      if (area.areas && area.areas.length > 0) {
        area.areas.forEach(child => {
          processArea(child, area.name);
        });
      }
    }
    
    // Обрабатываем все страны
    areas.forEach(country => {
      processArea(country);
    });
    
    return flatAreas;
  } catch (error) {
    console.error('Error fetching areas:', error);
    // Возвращаем базовый список городов при ошибке
    return [
      { id: '1', name: 'Москва' },
      { id: '2', name: 'Санкт-Петербург' },
      { id: '113', name: 'Россия' }
    ];
  }
}
// Проверка авторизации
function isAuthenticated(req, res, next) {
  // Пытаемся загрузить сохраненные токены, если их нет в сессии
  if (!req.session.tokens) {
    const storedTokens = loadStoredTokens();
    if (storedTokens) {
      req.session.tokens = storedTokens.tokens;
      req.session.userInfo = storedTokens.userInfo;
    }
  }
  if (req.session.tokens && req.session.tokens.access_token) {
    next();
  } else {
    res.redirect('/');
  }
}

// Функция преобразования данных резюме для Airtable
function transformResumeData(resume) {
  // Извлекаем контактную информацию
  let phone = '';
  let email = '';
  
  if (resume.contact) {
    resume.contact.forEach(contact => {
      if (contact.type.id === 'cell' || contact.type.id === 'home') {
        phone = (contact.value && contact.value.formatted) ? contact.value.formatted : (contact.value || '');
      }
      if (contact.type.id === 'email') {
        email = contact.value || '';
      }
    });
  }
  
  const fields = {
    Name: `${resume.last_name || ''} ${resume.first_name || ''} ${resume.middle_name || ''}`.trim() || 'Без имени',
    Email: email,
    "Phone number": phone,
    resume_url: resume.alternate_url || '',
    Job_Title: resume.title || '',
    area: resume.area ? resume.area.name : '',
    age: resume.age || null,
    salary_amount: resume.salary ? resume.salary.amount : 0,
    salary_currency: resume.salary ? resume.salary.currency : 'RUR',
    experience_months: resume.total_experience ? resume.total_experience.months : 0,
    last_employer: resume.experience && resume.experience.length > 0 ? resume.experience[0].company : '',
    education: resume.education && resume.education.primary && resume.education.primary.length > 0 
      ? `${resume.education.primary[0].name || ''} - ${resume.education.primary[0].organization || ''}` 
      : '',
    skills: resume.skill_set && resume.skill_set.length > 0 ? resume.skill_set.join(', ') : '',
    updated_at: new Date().toISOString().split('T')[0],
    "Hiring Status": "Candidate"
  };
  
  return {
    records: [
      {
        fields: fields
      }
    ]
  };
}

// Функция проверки дубликатов в Airtable
async function checkDuplicateInAirtable(resume) {
  try {
    // Извлекаем email и телефон из резюме
    let email = '';
    let phone = '';
    
    if (resume.contact) {
      resume.contact.forEach(contact => {
        if (contact.type.id === 'email') {
          email = contact.value || '';
        }
        if (contact.type.id === 'cell' || contact.type.id === 'home') {
          phone = (contact.value && contact.value.formatted) ? contact.value.formatted : (contact.value || '');
        }
      });
    }
    
    // Формируем URL резюме
    const resumeUrl = resume.alternate_url || '';
    
    // Создаем условия для проверки
    const conditions = [];
    if (email) conditions.push(`{Email}='${email}'`);
    if (phone) conditions.push(`{Phone number}='${phone}'`);
    if (resumeUrl) conditions.push(`{resume_url}='${resumeUrl}'`);
    
    // Если нет данных для проверки, считаем что дубликата нет
    if (conditions.length === 0) return false;
    
    // Формируем формулу для фильтрации
    const formula = `OR(${conditions.join(',')})`;
    
    // Делаем запрос к Airtable с timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 секунд timeout
    
    try {
      const response = await fetch(
        `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/People?` +
        `filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          signal: controller.signal
        }
      );
      
      clearTimeout(timeoutId);
    
      if (!response.ok) {
        console.error('Error checking duplicate:', await response.text());
        return false; // При ошибке разрешаем сохранение
      }
      
      const data = await response.json();
      
      // Если найдена хотя бы одна запись - это дубликат
      return data.records && data.records.length > 0;
      
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error('Timeout checking duplicate - allowing save');
        return false; // При timeout разрешаем сохранение
      }
      throw fetchError;
    }
  } catch (error) {
    console.error('Error in checkDuplicateInAirtable:', error);
    return false; // При ошибке разрешаем сохранение
  }
}

// Главная страница
app.get('/', (req, res) => {
  // Пытаемся загрузить сохраненные токены, если их нет в сессии
  if (!req.session.tokens) {
    const storedTokens = loadStoredTokens();
    if (storedTokens) {
      req.session.tokens = storedTokens.tokens;
      req.session.userInfo = storedTokens.userInfo;
    }
  }
  const isLoggedIn = req.session.tokens && req.session.tokens.access_token;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>HH → Airtable Integration</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 90%;
          text-align: center;
        }
        h1 {
          color: #333;
          margin-bottom: 10px;
          font-size: 28px;
        }
        .subtitle {
          color: #666;
          margin-bottom: 30px;
          font-size: 16px;
        }
        .status {
          padding: 15px;
          border-radius: 10px;
          margin: 20px 0;
          font-weight: 500;
        }
        .status.success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .status.warning {
          background: #fff3cd;
          color: #856404;
          border: 1px solid #ffeeba;
        }
        .button {
          display: inline-block;
          padding: 12px 30px;
          margin: 10px;
          background: #667eea;
          color: white;
          text-decoration: none;
          border-radius: 25px;
          font-weight: 500;
          transition: all 0.3s ease;
          border: none;
          cursor: pointer;
          font-size: 16px;
        }
        .button:hover {
          background: #5a67d8;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .button.secondary {
          background: #48bb78;
        }
        .button.secondary:hover {
          background: #38a169;
        }
        .user-info {
          background: #f7fafc;
          padding: 20px;
          border-radius: 10px;
          margin: 20px 0;
          text-align: left;
        }
        .user-info h3 {
          color: #2d3748;
          margin-bottom: 10px;
        }
        .user-info p {
          color: #4a5568;
          margin: 5px 0;
        }
        .features {
          text-align: left;
          margin: 30px 0;
        }
        .features h3 {
          color: #2d3748;
          margin-bottom: 15px;
        }
        .features ul {
          list-style: none;
          padding: 0;
        }
        .features li {
          padding: 8px 0;
          color: #4a5568;
        }
        .features li:before {
          content: "✓ ";
          color: #48bb78;
          font-weight: bold;
          margin-right: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔄 HH → Airtable</h1>
        <p class="subtitle">Интеграция HeadHunter с Airtable</p>
        
        ${isLoggedIn ? `
          <div class="status success">
            ✅ Вы авторизованы в HeadHunter
          </div>
          
          ${req.session.userInfo ? `
            <div class="user-info">
              <h3>👤 Информация о пользователе</h3>
              <p><strong>Email:</strong> ${req.session.userInfo.email}</p>
              <p><strong>Компания:</strong> ${req.session.userInfo.employer || 'Не указана'}</p>
              <p><strong>Тип аккаунта:</strong> ${req.session.userInfo.isEmployer ? 'Работодатель' : 'Соискатель'}</p>
            </div>
          ` : ''}
          
          <div class="features">
            <h3>Доступные функции:</h3>
            <ul>
              <li>Поиск резюме по параметрам</li>
              <li>Просмотр результатов поиска</li>
              <li>Проверка доступа к контактам</li>
              <li>Сохранение в Airtable</li>
            </ul>
          </div>
          
          <a href="/search" class="button">🔍 Поиск резюме</a>
          <a href="/logout" class="button secondary">🚪 Выйти</a>
        ` : `
          <div class="status warning">
            ⚠️ Требуется авторизация в HeadHunter
          </div>
          
          <div class="features">
            <h3>Возможности приложения:</h3>
            <ul>
              <li>Поиск резюме в базе HeadHunter</li>
              <li>Фильтрация по региону, зарплате, опыту</li>
              <li>Просмотр контактов кандидатов</li>
              <li>Автоматическое сохранение в Airtable</li>
              <li>Защищенные сессии пользователей</li>
            </ul>
          </div>
          
          <a href="/auth" class="button">🔐 Войти через HeadHunter</a>
        `}
      </div>
    </body>
    </html>
  `);
});

// Авторизация в HeadHunter
app.get('/auth', (req, res) => {
  const authUrl = `https://hh.ru/oauth/authorize?` +
    `response_type=code&` +
    `client_id=${process.env.HH_CLIENT_ID}&` +
    `redirect_uri=${process.env.HH_REDIRECT_URI}`;
  
  res.redirect(authUrl);
});

// Callback от HeadHunter
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.redirect('/?error=no_code');
  }
  
  try {
    // Получаем токены
    const tokenResponse = await fetch('https://hh.ru/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Origin': 'https://hh.ru',
        'Referer': 'https://hh.ru/'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.HH_CLIENT_ID,
        client_secret: process.env.HH_CLIENT_SECRET,
        redirect_uri: process.env.HH_REDIRECT_URI,
        code: code
      })
    });
    
    const responseText = await tokenResponse.text();
    console.log('HH Response Status:', tokenResponse.status);
    console.log('HH Response Headers:', tokenResponse.headers.raw());
    console.log('HH Response Body (first 500 chars):', responseText.substring(0, 500));
    
    let tokens;
    try {
      tokens = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse HH response as JSON');
      throw new Error('HeadHunter вернул неверный ответ. Возможно, сервис временно недоступен.');
    }
    
    console.log('Token response status:', tokenResponse.status);
    console.log('Token response:', tokens);
    
    if (tokens.error) {
      console.error('HH OAuth error:', tokens);
      throw new Error(tokens.error_description || tokens.error);
    }
    
    // Сохраняем токены в сессию
    req.session.tokens = tokens;
    
    // Получаем информацию о пользователе
    const userResponse = await fetch('https://api.hh.ru/me', {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'User-Agent': 'HH-Airtable-App/1.0'
      }
    });
    
    const userData = await userResponse.json();
    
    // Сохраняем информацию о пользователе
    req.session.userInfo = {
      email: userData.email,
      employer: userData.employer ? userData.employer.name : null,
      employerId: userData.employer ? userData.employer.id : null,
      isEmployer: !!userData.employer
    };
    
    // Сохраняем токены и информацию о пользователе в файл
    saveTokens(tokens, req.session.userInfo);
    
    res.redirect('/');
  } catch (error) {
    console.error('Auth error:', error);
    res.redirect('/?error=auth_failed');
  }
});

// Страница поиска
app.get('/search', isAuthenticated, async (req, res) => {
  // Пытаемся загрузить сохраненные токены, если их нет в сессии
  if (!req.session.tokens) {
    const storedTokens = loadStoredTokens();
    if (storedTokens) {
      req.session.tokens = storedTokens.tokens;
      req.session.userInfo = storedTokens.userInfo;
    }
  }
  
  // Получаем список городов
  const areas = await getAreasFromHH();
  
  // Популярные города для быстрого доступа
  const popularAreas = [
    { id: '1', name: 'Москва' },
    { id: '2', name: 'Санкт-Петербург' },
    { id: '3', name: 'Екатеринбург' },
    { id: '4', name: 'Новосибирск' },
    { id: '113', name: 'Россия' },
    { id: '40', name: 'Казахстан' },
    { id: '97', name: 'Узбекистан' }
  ];
  
  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Поиск резюме - HH → Airtable</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f7fafc;
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        h1 {
          color: #2d3748;
          margin-bottom: 30px;
          text-align: center;
        }
        .form-group {
          margin-bottom: 25px;
        }
        label {
          display: block;
          color: #4a5568;
          font-weight: 500;
          margin-bottom: 8px;
        }
        input, select {
          width: 100%;
          padding: 12px;
          border: 2px solid #e2e8f0;
          border-radius: 10px;
          font-size: 16px;
          transition: border-color 0.3s;
        }
        input:focus, select:focus {
          outline: none;
          border-color: #667eea;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        button {
          width: 100%;
          padding: 14px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 18px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s;
        }
        button:hover {
          background: #5a67d8;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        .help-text {
          font-size: 14px;
          color: #718096;
          margin-top: 5px;
        }
        .back-link {
          text-align: center;
          margin-top: 20px;
        }
        .back-link a {
          color: #667eea;
          text-decoration: none;
        }
        .back-link a:hover {
          text-decoration: underline;
        }
        .area-search-container {
          position: relative;
        }
        .area-search-input {
          width: 100%;
          padding: 12px;
          border: 2px solid #e2e8f0;
          border-radius: 10px;
          font-size: 16px;
        }
        .area-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          max-height: 300px;
          overflow-y: auto;
          background: white;
          border: 2px solid #e2e8f0;
          border-top: none;
          border-radius: 0 0 10px 10px;
          display: none;
          z-index: 100;
        }
        .area-dropdown.show {
          display: block;
        }
        .area-item {
          padding: 10px 15px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .area-item:hover {
          background: #f7fafc;
        }
        .area-item.selected {
          background: #667eea;
          color: white;
        }
        .popular-areas {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 10px;
        }
        .popular-area-chip {
          padding: 6px 12px;
          background: #e2e8f0;
          border-radius: 20px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .popular-area-chip:hover {
          background: #cbd5e0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🔍 Поиск резюме</h1>
        
        <form action="/search-results" method="get">
          <div class="form-group">
            <label for="text">Ключевые слова для поиска</label>
            <input 
              type="text" 
              id="text" 
              name="text" 
              placeholder="Например: менеджер по продажам, JavaScript developer"
              required
            >
            <p class="help-text">Введите должность, навыки или другие ключевые слова</p>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label for="area">Регион</label>
              <div class="area-search-container">
                <input 
                  type="text" 
                  id="area-search" 
                  class="area-search-input"
                  placeholder="Начните вводить название города..."
                  autocomplete="off"
                >
                <input type="hidden" id="area" name="area" value="113">
                <div id="area-dropdown" class="area-dropdown"></div>
              </div>
              <div class="popular-areas">
                ${popularAreas.map(area => `
                  <div class="popular-area-chip" onclick="selectArea('${area.id}', '${area.name}')">
                    ${area.name}
                  </div>
                `).join('')}
              </div>
            </div>
            
            <div class="form-group">
              <label for="experience">Опыт работы</label>
              <select id="experience" name="experience">
                <option value="">Любой</option>
                <option value="noExperience">Нет опыта</option>
                <option value="between1And3">От 1 до 3 лет</option>
                <option value="between3And6">От 3 до 6 лет</option>
                <option value="moreThan6">Более 6 лет</option>
              </select>
            </div>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label for="salary_from">Зарплата от (руб.)</label>
              <input 
                type="number" 
                id="salary_from" 
                name="salary_from" 
                placeholder="Например: 50000"
              >
            </div>
            
            <div class="form-group">
              <label for="per_page">Количество результатов</label>
              <select id="per_page" name="per_page">
                <option value="10">10 резюме</option>
                <option value="20" selected>20 резюме</option>
                <option value="50">50 резюме</option>
                <option value="100">100 резюме</option>
              </select>
            </div>
            <div class="form-group">
              <label for="update_period">Дата обновления резюме</label>
              <select id="update_period" name="update_period">
                <option value="">Любая дата</option>
                <option value="1">За последние 24 часа</option>
                <option value="3">За последние 3 дня</option>
                <option value="7">За последнюю неделю</option>
                <option value="14">За последние 2 недели</option>
                <option value="30">За последний месяц</option>
              </select>
              <p class="help-text">Показывать только резюме, обновленные в выбранный период</p>
            </div>
          </div>
          
          <div class="form-group">
            <label for="skills_must_have">Обязательные навыки (через запятую)</label>
            <input 
              type="text" 
              id="skills_must_have" 
              name="skills_must_have" 
              placeholder="Например: AutoCAD, SolidWorks, релейная защита"
            >
            <p class="help-text">Кандидат должен иметь ВСЕ указанные навыки</p>
          </div>

          <div class="form-group">
            <label for="skills_nice_to_have">Желательные навыки (через запятую)</label>
            <input 
              type="text" 
              id="skills_nice_to_have" 
              name="skills_nice_to_have" 
              placeholder="Например: SAP, 1C, Oracle, MS Project"
            >
            <p class="help-text">Достаточно хотя бы одного из указанных навыков</p>
          </div>
                    <div class="form-group">
            <label for="search_in_fields">Где искать</label>
            <select id="search_in_fields" name="search_in_fields">
              <option value="all">Везде (название резюме + опыт работы + навыки)</option>
              <option value="title">Только в названии резюме</option>
              <option value="experience">Только в опыте работы</option>
            </select>
            <p class="help-text">Поиск только в названии резюме даст более точные результаты</p>
          </div>

          <div class="form-group">
            <label for="exclude_words">Исключить слова (через запятую)</label>
            <input 
              type="text" 
              id="exclude_words" 
              name="exclude_words" 
              placeholder="Например: кадры, персонал, HR, продажи"
            >
            <p class="help-text">Резюме с этими словами будут исключены из результатов</p>
          </div>

          <div class="form-group">
            <label for="exact_phrase">
              <input type="checkbox" id="exact_phrase" name="exact_phrase" value="1" style="width: auto; margin-right: 10px;">
              Искать точную фразу
            </label>
            <p class="help-text">Будет искать слова именно в том порядке, как вы написали</p>
          </div>
          
          <button type="submit">🔍 Начать поиск</button>
        </form>
        
        <div class="back-link">
          <a href="/">← Вернуться на главную</a>
        </div>
      </div>
      
      <script>
        const areas = ${JSON.stringify(areas)};
        let selectedAreaId = '113'; // Россия по умолчанию
        let selectedAreaName = 'Россия';
        
        const areaSearch = document.getElementById('area-search');
        const areaDropdown = document.getElementById('area-dropdown');
        const areaInput = document.getElementById('area');
        
        // Устанавливаем значение по умолчанию
        areaSearch.value = selectedAreaName;
        
        function selectArea(id, name) {
          selectedAreaId = id;
          selectedAreaName = name;
          areaSearch.value = name;
          areaInput.value = id;
          areaDropdown.classList.remove('show');
        }
        
        function filterAreas(query) {
          const filtered = areas.filter(area => 
            area.name.toLowerCase().includes(query.toLowerCase())
          ).slice(0, 20); // Показываем только первые 20 результатов
          
          areaDropdown.innerHTML = filtered.map(area => 
            '<div class="area-item" onclick="selectArea(\\'' + area.id + '\\', \\'' + area.name.replace(/'/g, "\\\\'") + '\\')">' + area.name + '</div>'
          ).join('');
          
          areaDropdown.classList.add('show');
        }
        
        areaSearch.addEventListener('input', function() {
          const query = this.value.trim();
          if (query.length > 0) {
            filterAreas(query);
          } else {
            areaDropdown.classList.remove('show');
          }
        });
        
        areaSearch.addEventListener('focus', function() {
          if (this.value.trim().length > 0) {
            filterAreas(this.value.trim());
          }
        });
        
        // Закрываем dropdown при клике вне его
        document.addEventListener('click', function(e) {
          if (!e.target.closest('.area-search-container')) {
            areaDropdown.classList.remove('show');
          }
        });
        
        // Предотвращаем отправку формы при нажатии Enter в поле поиска города
        areaSearch.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            const firstItem = areaDropdown.querySelector('.area-item');
            if (firstItem) {
              firstItem.click();
            }
          }
        });
      </script>
    </body>
    </html>
  `);
});

// Результаты поиска
app.get('/search-results', isAuthenticated, async (req, res) => {
  try {
    // Формируем поисковый запрос с учетом настроек точности
let searchText = req.query.text || '';

// Если выбран поиск точной фразы
if (req.query.exact_phrase === '1') {
  searchText = `"${searchText}"`;
}

// Добавляем исключения
if (req.query.exclude_words) {
  const excludeWords = req.query.exclude_words.split(',').map(w => w.trim()).filter(w => w);
  excludeWords.forEach(word => {
    searchText += ` NOT "${word}"`;
  });
}

const searchParams = new URLSearchParams({
  text: searchText,
  area: req.query.area || '1',
  per_page: req.query.per_page || '20',
  page: req.query.page || '0'
});

// Добавляем поле поиска если указано
if (req.query.search_in_fields && req.query.search_in_fields !== 'all') {
  if (req.query.search_in_fields === 'title') {
    searchParams.append('search_field', 'name');
  } else if (req.query.search_in_fields === 'experience') {
    searchParams.append('search_field', 'description');
  }
}
    
    // Добавляем опциональные параметры
    if (req.query.experience) searchParams.append('experience', req.query.experience);
    if (req.query.salary_from) searchParams.append('salary_from', req.query.salary_from);

    // Добавляем фильтр по дате обновления
    if (req.query.update_period) {
    const days = parseInt(req.query.update_period);
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);
    const formattedDate = dateFrom.toISOString().split('T')[0]; // Формат YYYY-MM-DD
    searchParams.append('date_from', formattedDate);
  }
   
    // Обработка навыков
    if (req.query.skills_must_have || req.query.skills_nice_to_have) {
      let skillsText = req.query.text || '';
      
      if (req.query.skills_must_have) {
        const mustHaveSkills = req.query.skills_must_have.split(',').map(s => s.trim()).filter(s => s);
        if (mustHaveSkills.length > 0) {
          skillsText += ' ' + mustHaveSkills.join(' ');
        }
      }
      
      if (req.query.skills_nice_to_have) {
        const niceToHaveSkills = req.query.skills_nice_to_have.split(',').map(s => s.trim()).filter(s => s);
        if (niceToHaveSkills.length > 0) {
          skillsText += ' ' + niceToHaveSkills.join(' OR ');
        }
      }
      
      searchParams.set('text', skillsText.trim());
    }
    
    const response = await fetch(`https://api.hh.ru/resumes?${searchParams}`, {
      headers: {
        'Authorization': `Bearer ${req.session.tokens.access_token}`,
        'User-Agent': 'HH-Airtable-App/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    res.send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Результаты поиска - HH → Airtable</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f7fafc;
            padding: 20px;
          }
          .container {
            max-width: 1200px;
            margin: 0 auto;
          }
          h1 {
            color: #2d3748;
            margin-bottom: 20px;
            text-align: center;
          }
          .summary {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .resume-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
          }
          .resume-card {
            background: white;
            position: relative;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            transition: transform 0.3s, box-shadow 0.3s;
          }
          .resume-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 5px 20px rgba(0,0,0,0.15);
          }
          .resume-header {
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 15px;
            margin-bottom: 15px;
          }
          .resume-title {
            font-size: 18px;
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 5px;
          }
          .resume-name {
            color: #4a5568;
            font-size: 16px;
          }
          .resume-details {
            font-size: 14px;
            color: #718096;
            line-height: 1.6;
          }
          .resume-detail {
            margin: 5px 0;
          }
          .buttons {
            display: flex;
            gap: 10px;
            margin-top: 15px;
          }
          .button {
            flex: 1;
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            text-align: center;
            text-decoration: none;
            transition: all 0.3s;
          }
          .button.primary {
            background: #667eea;
            color: white;
          }
          .button.primary:hover {
            background: #5a67d8;
          }
          .button.secondary {
            background: #e2e8f0;
            color: #4a5568;
          }
          .button.secondary:hover {
            background: #cbd5e0;
          }
          .navigation {
            text-align: center;
            margin-top: 30px;
          }
          .navigation a {
            color: #667eea;
            text-decoration: none;
            margin: 0 10px;
          }
          .navigation a:hover {
            text-decoration: underline;
          }
          .loading {
            text-align: center;
            padding: 40px;
          }
          .spinner {
            border: 3px solid #f3f4f6;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .checkbox-container {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 10;
          }
          .checkbox-container input[type="checkbox"] {
            width: 20px;
            height: 20px;
            cursor: pointer;
          }
          .resume-card.selected {
            background: #e6f3ff;
            border: 2px solid #667eea;
          }
          .selection-controls {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .selection-info {
            font-size: 16px;
            color: #4a5568;
          }
          .selection-buttons {
            display: flex;
            gap: 10px;
            align-items: center;
          }
          .button.save-selected {
            background: #48bb78;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.3s;
          }
          .button.save-selected:hover {
            background: #38a169;
          }
          .button.save-selected:disabled {
            background: #cbd5e0;
            cursor: not-allowed;
          }
          .progress-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
          }
          .progress-content {
            background: white;
            padding: 30px;
            border-radius: 10px;
            text-align: center;
            min-width: 400px;
          }
          .progress-bar {
            width: 100%;
            height: 20px;
            background: #e2e8f0;
            border-radius: 10px;
            margin: 20px 0;
            overflow: hidden;
          }
          .progress-fill {
            height: 100%;
            background: #48bb78;
            width: 0%;
            transition: width 0.3s;
          }
          .open-contacts-option {
            display: inline-block;
            margin: 0 10px;
            padding: 10px 15px;
            background: #f0f0f0;
            border-radius: 5px;
          }
          .open-contacts-option label {
            display: flex;
            align-items: center;
            cursor: pointer;
            font-size: 14px;
          }
          .open-contacts-option input[type="checkbox"] {
            margin-right: 8px;
            width: 16px;
            height: 16px;
          }
          .open-contacts-option span {
            color: #333;
            font-weight: 500;
          }
        </style>
        <script>
window.toggleResumeSelection = function(checkbox) {
  console.log('Checkbox clicked!');
  const card = checkbox.closest('.resume-card');
  if (checkbox.checked) {
    card.classList.add('selected');
  } else {
    card.classList.remove('selected');
  }
  window.updateSelectionInfo();
}

window.updateSelectionInfo = function() {
  const checkboxes = document.querySelectorAll('.resume-checkbox');
  const checked = document.querySelectorAll('.resume-checkbox:checked');
  document.getElementById('selection-count').textContent = checked.length;
  document.getElementById('total-count').textContent = checkboxes.length;
  document.getElementById('save-selected').disabled = checked.length === 0;
}

window.selectAll = function() {
  const checkboxes = document.querySelectorAll('.resume-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = true;
    cb.closest('.resume-card').classList.add('selected');
  });
  window.updateSelectionInfo();
}

window.deselectAll = function() {
  const checkboxes = document.querySelectorAll('.resume-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = false;
    cb.closest('.resume-card').classList.remove('selected');
  });
  window.updateSelectionInfo();
}

window.saveSelected = async function() {
  const checked = document.querySelectorAll('.resume-checkbox:checked');
  const openPaidContacts = document.getElementById('open-paid-contacts').checked;
  
  if (checked.length === 0) {
    alert('Выберите хотя бы одно резюме');
    return;
  }
  
  if (!confirm('Сохранить ' + checked.length + ' резюме в Airtable?' + 
    (openPaidContacts ? '\\n\\nВНИМАНИЕ: Будут открыты платные контакты!' : ''))) {
    return;
  }
  
  const progressModal = document.getElementById('progress-modal');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-fill');
  
  progressModal.style.display = 'flex';
  progressText.textContent = 'Подготовка к сохранению...';
  progressFill.style.width = '0%';
  
  const saveButton = document.getElementById('save-selected');
  saveButton.disabled = true;
  
  let saved = 0;
  let errors = 0;
  let paidContactsOpened = 0;
  let savedWithFreeContacts = 0;
  let savedWithoutContacts = 0;
  let duplicates = 0;
  
  for (let j = 0; j < checked.length; j++) {
    const resumeId = checked[j].value;
    progressText.textContent = 'Сохранение ' + (j + 1) + ' из ' + checked.length + '...';
    progressFill.style.width = ((j + 1) / checked.length * 100) + '%';
    
    try {
      const response = await fetch('/api/save-to-airtable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          resumeId: resumeId,
          openPaidContacts: openPaidContacts 
        })
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        saved++;
        if (result.paidContactOpened) {
          paidContactsOpened++;
        } else if (result.hadFreeContacts) {
          savedWithFreeContacts++;
        } else {
          savedWithoutContacts++;
        }
      } else if (result.isDuplicate) {
        duplicates++;
        console.log('Пропущен дубликат');
      } else {
        errors++;
        console.error('Ошибка сохранения:', result.error);
      }
    } catch (e) {
      errors++;
      console.error('Ошибка запроса:', e);
    }
    
    // Задержка между запросами
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  progressModal.style.display = 'none';
  
  // Показываем детальный отчет
  let reportMessage = 'ОТЧЕТ О СОХРАНЕНИИ:\\n\\n';
  reportMessage += 'Всего обработано: ' + checked.length + '\\n';
  reportMessage += 'Успешно сохранено: ' + saved + '\\n';
  if (duplicates > 0) {
    reportMessage += '❗ Пропущено дубликатов: ' + duplicates + '\\n';
  }
  if (savedWithFreeContacts > 0) {
    reportMessage += '✓ С бесплатными контактами: ' + savedWithFreeContacts + '\\n';
  }
  if (paidContactsOpened > 0) {
    reportMessage += '💰 С платными контактами: ' + paidContactsOpened + '\\n';
  }
  if (savedWithoutContacts > 0) {
    reportMessage += '⚠️ Без контактов: ' + savedWithoutContacts + '\\n';
  }
  if (errors > 0) {
    reportMessage += '❌ Ошибок: ' + errors + '\\n';
  }
  
  alert(reportMessage);
  
  if (saved > 0) {
    window.deselectAll();
  }
}

// Инициализация при загрузке страницы
window.onload = function() {
  console.log('Page loaded, initializing...');
  window.updateSelectionInfo();
};
</script>
      </head>
      <body>
        <div class="container">
          <h1>📋 Результаты поиска</h1>
          
          <div class="summary">
            <p><strong>Найдено резюме:</strong> ${data.found} | 
            <strong>Показано:</strong> ${data.items.length} | 
            <strong>Поиск:</strong> "${req.query.text}"</p>
          </div>
          
          <div class="selection-controls">
            <div class="selection-info">
              Выбрано <span id="selection-count">0</span> из <span id="total-count">${data.items.length}</span> резюме
            </div>
            <div class="selection-buttons">
              <button type="button" class="button secondary" onclick="window.selectAll()">Выбрать все</button>
              <button type="button" class="button secondary" onclick="window.deselectAll()">Снять выделение</button>
              <div class="open-contacts-option">
                <label>
                  <input type="checkbox" id="open-paid-contacts" />
                  <span>Открывать платные контакты</span>
                </label>
              </div>
              <button type="button" id="save-selected" class="button save-selected" onclick="window.saveSelected()" disabled>
                💾 Сохранить выбранные в Airtable
              </button>
            </div>
          </div>

          <div id="progress-modal" class="progress-modal">
            <div class="progress-content">
              <h2>Сохранение резюме</h2>
              <p id="progress-text">Подготовка...</p>
              <div class="progress-bar">
                <div id="progress-fill" class="progress-fill"></div>
              </div>
            </div>
          </div>
          
          <div class="resume-grid">
            ${data.items.map(resume => `
              <div class="resume-card">
                <div class="checkbox-container">
                  <input type="checkbox" class="resume-checkbox" value="${resume.id}" onchange="window.toggleResumeSelection(this)">
                </div>
                <div class="resume-header">
                  <div class="resume-title">${resume.title || 'Без названия'}</div>
                  <div class="resume-name">
                    ${resume.first_name || ''} ${resume.last_name || ''}
                  </div>
                </div>
                
                <div class="resume-details">
                  ${resume.area ? `
                    <div class="resume-detail">📍 ${resume.area.name}</div>
                  ` : ''}
                  
                  ${resume.age ? `
                    <div class="resume-detail">👤 ${resume.age} лет</div>
                  ` : ''}
                  
                  ${resume.salary ? `
                    <div class="resume-detail">💰 ${resume.salary.amount.toLocaleString('ru-RU')} ${resume.salary.currency}</div>
                  ` : ''}
                  
                  ${resume.total_experience ? `
                    <div class="resume-detail">💼 Опыт: ${Math.floor(resume.total_experience.months / 12)} лет</div>
                  ` : ''}
                </div>
                
                <div class="buttons">
                  <a href="/resume/${resume.id}" class="button primary">Подробнее</a>
                  <a href="${resume.alternate_url}" target="_blank" class="button secondary">На HH.ru</a>
                </div>
              </div>
            `).join('')}
          </div>
          
          <div class="navigation">
            <a href="/search">← Новый поиск</a>
            ${data.page > 0 ? `
              <a href="/search-results?${new URLSearchParams({...req.query, page: data.page - 1})}">← Предыдущая</a>
            ` : ''}
            ${data.pages > data.page + 1 ? `
              <a href="/search-results?${new URLSearchParams({...req.query, page: data.page + 1})}">Следующая →</a>
            ` : ''}
            <a href="/">На главную</a>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Search error:', error);
    res.send(`
      <h1>Ошибка поиска</h1>
      <p>${error.message}</p>
      <a href="/search">Попробовать снова</a>
    `);
  }
});

// Просмотр резюме
app.get('/resume/:id', isAuthenticated, async (req, res) => {
  try {
    const resumeId = req.params.id;
    
    // Получаем информацию о резюме
    const response = await fetch(`https://api.hh.ru/resumes/${resumeId}`, {
      headers: {
        'Authorization': `Bearer ${req.session.tokens.access_token}`,
        'User-Agent': 'HH-Airtable-App/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const resume = await response.json();
    
    // Проверяем, можем ли просмотреть контакты
    const canViewContacts = resume.actions && resume.actions.get_with_contact;
    const hasContact = resume.contact && resume.contact.length > 0;
    
    res.send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${resume.title || 'Резюме'} - HH → Airtable</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f7fafc;
            padding: 20px;
          }
          .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          }
          h1 {
            color: #2d3748;
            margin-bottom: 10px;
          }
          .subtitle {
            color: #718096;
            font-size: 18px;
            margin-bottom: 30px;
          }
          .section {
            margin-bottom: 30px;
            padding-bottom: 30px;
            border-bottom: 1px solid #e2e8f0;
          }
          .section:last-child {
            border-bottom: none;
          }
          .section-title {
            font-size: 20px;
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 15px;
          }
          .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
          }
          .info-item {
            padding: 15px;
            background: #f7fafc;
            border-radius: 8px;
          }
          .info-label {
            font-size: 14px;
            color: #718096;
            margin-bottom: 5px;
          }
          .info-value {
            font-size: 16px;
            color: #2d3748;
            font-weight: 500;
          }
          .contact-section {
            background: #fef5e7;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
          }
          .contact-warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
          }
          .action-buttons {
            display: flex;
            gap: 15px;
            margin-top: 30px;
          }
          .button {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.3s;
            text-align: center;
          }
          .button.primary {
            background: #48bb78;
            color: white;
            flex: 1;
          }
          .button.primary:hover {
            background: #38a169;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(72, 187, 120, 0.4);
          }
          .button.secondary {
            background: #667eea;
            color: white;
          }
          .button.secondary:hover {
            background: #5a67d8;
          }
          .button.disabled {
            background: #cbd5e0;
            color: #718096;
            cursor: not-allowed;
          }
          .experience-item {
            margin-bottom: 20px;
            padding: 15px;
            background: #f7fafc;
            border-radius: 8px;
          }
          .experience-title {
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 5px;
          }
          .experience-company {
            color: #4a5568;
            margin-bottom: 5px;
          }
          .experience-period {
            font-size: 14px;
            color: #718096;
          }
          .back-link {
            text-align: center;
            margin-top: 30px;
          }
          .back-link a {
            color: #667eea;
            text-decoration: none;
          }
          .back-link a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${resume.title || 'Без названия'}</h1>
          <p class="subtitle">${resume.first_name || ''} ${resume.last_name || ''}</p>
          
          <div class="section">
            <h2 class="section-title">📋 Основная информация</h2>
            <div class="info-grid">
              ${resume.age ? `
                <div class="info-item">
                  <div class="info-label">Возраст</div>
                  <div class="info-value">${resume.age} лет</div>
                </div>
              ` : ''}
              
              ${resume.area ? `
                <div class="info-item">
                  <div class="info-label">Город</div>
                  <div class="info-value">${resume.area.name}</div>
                </div>
              ` : ''}
              
              ${resume.salary ? `
                <div class="info-item">
                  <div class="info-label">Желаемая зарплата</div>
                  <div class="info-value">${resume.salary.amount.toLocaleString('ru-RU')} ${resume.salary.currency}</div>
                </div>
              ` : ''}
              
              ${resume.total_experience ? `
                <div class="info-item">
                  <div class="info-label">Общий опыт работы</div>
                  <div class="info-value">${Math.floor(resume.total_experience.months / 12)} лет</div>
                </div>
              ` : ''}
            </div>
          </div>
          
          ${hasContact ? `
            <div class="section">
              <h2 class="section-title">📞 Контактная информация</h2>
              <div class="info-grid">
                ${resume.contact.map(contact => `
                  <div class="info-item">
                    <div class="info-label">${contact.type.name}</div>
                    <div class="info-value">${(contact.value && contact.value.formatted) ? contact.value.formatted : (contact.value || '')}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : canViewContacts ? `
            <div class="contact-section">
              <h2 class="section-title">📞 Контактная информация</h2>
              <div class="contact-warning">
                <strong>Внимание!</strong> Для просмотра контактов необходимо использовать платный просмотр.
                Это действие спишет 1 просмотр из вашего пакета доступа к базе резюме.
              </div>
              <form action="/view-contacts" method="post" style="display: inline;">
                <input type="hidden" name="resumeId" value="${resumeId}">
                <button type="submit" class="button secondary">👁️ Просмотреть контакты (платно)</button>
              </form>
            </div>
          ` : ''}
          
          ${resume.experience && resume.experience.length > 0 ? `
            <div class="section">
              <h2 class="section-title">💼 Опыт работы</h2>
              ${resume.experience.slice(0, 3).map(exp => `
                <div class="experience-item">
                  <div class="experience-title">${exp.position}</div>
                  <div class="experience-company">${exp.company || 'Компания не указана'}</div>
                  <div class="experience-period">
                    ${exp.start} - ${exp.end || 'по настоящее время'}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          <div class="action-buttons">
            ${hasContact || canViewContacts ? `
              <form action="/save-to-airtable" method="post" style="flex: 1;">
                <input type="hidden" name="resumeId" value="${resumeId}">
                <button type="submit" class="button primary" style="width: 100%;">
                  💾 Сохранить в Airtable
                </button>
              </form>
            ` : `
              <button class="button disabled" style="flex: 1;" disabled>
                💾 Нет доступа к контактам
              </button>
            `}
            <a href="${resume.alternate_url}" target="_blank" class="button secondary">
              🔗 Открыть на HH.ru
            </a>
          </div>
          
          <div class="back-link">
            <a href="javascript:history.back()">← Назад к результатам</a> | 
            <a href="/search">Новый поиск</a> | 
            <a href="/">На главную</a>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Resume view error:', error);
    res.send(`
      <h1>Ошибка</h1>
      <p>${error.message}</p>
      <a href="/search">Вернуться к поиску</a>
    `);
  }
});

// Просмотр контактов (платная операция)
app.post('/view-contacts', isAuthenticated, async (req, res) => {
  try {
    const { resumeId } = req.body;
    
    // Сначала получаем резюме чтобы найти URL для просмотра с контактами
    const resumeResponse = await fetch(`https://api.hh.ru/resumes/${resumeId}`, {
      headers: {
        'Authorization': `Bearer ${req.session.tokens.access_token}`,
        'User-Agent': 'HH-Airtable-App/1.0'
      }
    });
    
    if (!resumeResponse.ok) {
      throw new Error('Не удалось получить резюме');
    }
    
    const resumeData = await resumeResponse.json();
    
    if (!resumeData.actions || !resumeData.actions.get_with_contact) {
      throw new Error('Нет доступа к контактам этого резюме');
    }
    
    // Используем специальный URL для получения контактов
    const contactResponse = await fetch(resumeData.actions.get_with_contact.url, {
      headers: {
        'Authorization': `Bearer ${req.session.tokens.access_token}`,
        'User-Agent': 'HH-Airtable-App/1.0'
      }
    });
    
    if (!contactResponse.ok) {
      throw new Error('Не удалось получить контакты');
    }
    
    // После успешного просмотра перенаправляем обратно на страницу резюме
    res.redirect(`/resume/${resumeId}`);
    
  } catch (error) {
    console.error('Contact view error:', error);
    res.send(`
      <h1>Ошибка просмотра контактов</h1>
      <p>${error.message}</p>
      <a href="/resume/${req.body.resumeId}">Вернуться к резюме</a>
    `);
  }
});
// Сохранение в Airtable
app.post('/save-to-airtable', isAuthenticated, async (req, res) => {
  try {
    const { resumeId } = req.body;
    
    // Получаем полную информацию о резюме
    const resumeResponse = await fetch(`https://api.hh.ru/resumes/${resumeId}`, {
      headers: {
        'Authorization': `Bearer ${req.session.tokens.access_token}`,
        'User-Agent': 'HH-Airtable-App/1.0'
      }
    });
    
    if (!resumeResponse.ok) {
      throw new Error('Не удалось получить резюме');
    }
    
    const resume = await resumeResponse.json();
    
    // Проверяем на дубликат
    const isDuplicate = await checkDuplicateInAirtable(resume);
    
    if (isDuplicate) {
      // Если найден дубликат, показываем сообщение
      return res.send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Дубликат - HH → Airtable</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
              max-width: 500px;
              width: 90%;
              text-align: center;
            }
            .warning-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h1 {
              color: #f59e0b;
              margin-bottom: 20px;
            }
            p {
              color: #4a5568;
              margin-bottom: 30px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 12px 30px;
              margin: 10px;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 25px;
              font-weight: 500;
              transition: all 0.3s ease;
            }
            .button:hover {
              background: #5a67d8;
              transform: translateY(-2px);
              box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="warning-icon">⚠️</div>
            <h1>Резюме уже есть в базе</h1>
            <p>Это резюме уже сохранено в вашей базе Airtable. Дубликаты не сохраняются для поддержания чистоты данных.</p>
            <a href="javascript:history.back()" class="button">← Вернуться назад</a>
            <a href="/search" class="button">🔍 Продолжить поиск</a>
          </div>
        </body>
        </html>
      `);
    }
    
    // Преобразуем данные для Airtable
    const airtableData = transformResumeData(resume);
    
    // Отправляем в Airtable
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/People`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(airtableData)
      }
    );
    
    if (!airtableResponse.ok) {
      const error = await airtableResponse.text();
      console.error('Airtable error:', error);
      throw new Error('Не удалось сохранить в Airtable');
    }
    
    const result = await airtableResponse.json();

    // Показываем результат
    res.send(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Успешно сохранено - HH → Airtable</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            max-width: 500px;
            width: 90%;
            text-align: center;
          }
          .success-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            color: #48bb78;
            margin-bottom: 20px;
          }
          p {
            color: #4a5568;
            margin-bottom: 30px;
            line-height: 1.6;
          }
          .button {
            display: inline-block;
            padding: 12px 30px;
            margin: 10px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 25px;
            font-weight: 500;
            transition: all 0.3s ease;
          }
          .button:hover {
            background: #5a67d8;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
          }
          .button.secondary {
            background: #48bb78;
          }
          .button.secondary:hover {
            background: #38a169;
          }
          .details {
            background: #f7fafc;
            padding: 20px;
            border-radius: 10px;
            margin: 20px 0;
            text-align: left;
          }
          .details-title {
            font-weight: 600;
            color: #2d3748;
            margin-bottom: 10px;
          }
          .details-item {
            color: #4a5568;
            margin: 5px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>Успешно сохранено!</h1>
          <p>Резюме было успешно добавлено в вашу базу Airtable.</p>
          
          <div class="details">
            <div class="details-title">Детали записи:</div>
            <div class="details-item">ID в Airtable: ${result.records[0].id}</div>
            <div class="details-item">Кандидат: ${airtableData.records[0].fields.Name}</div>
            <div class="details-item">Должность: ${airtableData.records[0].fields.Job_Title || 'Не указана'}</div>
          </div>
          
          <a href="/search" class="button">🔍 Продолжить поиск</a>
          <a href="https://airtable.com/${process.env.AIRTABLE_BASE_ID}" target="_blank" class="button secondary">📊 Открыть Airtable</a>
        </div>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Save error:', error);
    res.send(`
      <h1>Ошибка сохранения</h1>
      <p>${error.message}</p>
      <a href="/resume/${req.body.resumeId}">Вернуться к резюме</a>
    `);
  }
});

// API endpoint для массового сохранения резюме
app.post('/api/save-to-airtable', isAuthenticated, async (req, res) => {
  try {
    const { resumeId, openPaidContacts } = req.body;
    
    if (!resumeId) {
      return res.status(400).json({ error: 'Resume ID is required' });
    }
    
    // Получаем токен
    const token = await getValidToken(req);
    
    // Сначала получаем полную информацию о резюме
    const resumeResponse = await fetch(`https://api.hh.ru/resumes/${resumeId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'HH-Airtable App/1.0'
      }
    });
    
    if (!resumeResponse.ok) {
      throw new Error(`Failed to fetch resume: ${resumeResponse.status}`);
    }
    
    let resumeData = await resumeResponse.json();
    
    // Проверяем на дубликат
    const isDuplicate = await checkDuplicateInAirtable(resumeData);
    
    if (isDuplicate) {
      // Возвращаем специальный ответ для дубликата
      return res.json({ 
        success: false, 
        isDuplicate: true,
        error: 'Duplicate resume' 
      });
    }
    
    let paidContactOpened = false;
    let hadFreeContacts = false;
    
    // Проверяем наличие контактов
    const hasContacts = resumeData.contact && resumeData.contact.length > 0;
    
    if (hasContacts) {
      // Контакты уже есть (бесплатные)
      hadFreeContacts = true;
    } else if (openPaidContacts && resumeData.actions && resumeData.actions.get_with_contact) {
      // Открываем платные контакты
      const contactResponse = await fetch(resumeData.actions.get_with_contact.url, {
        method: resumeData.actions.get_with_contact.method || 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'HH-Airtable App/1.0'
        }
      });
      
      if (contactResponse.ok) {
        resumeData = await contactResponse.json();
        paidContactOpened = true;
      }
    }
    
    // Преобразуем данные для Airtable
    const airtableData = transformResumeData(resumeData);
    
    // Сохраняем в Airtable
    const airtableResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/People`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(airtableData)
      }
    );
    
    if (!airtableResponse.ok) {
      const error = await airtableResponse.text();
      throw new Error(`Airtable error: ${error}`);
    }
    
    const result = await airtableResponse.json();
    
    res.json({ 
      success: true, 
      id: result.records[0].id,
      paidContactOpened: paidContactOpened,
      hadFreeContacts: hadFreeContacts
    });
    
  } catch (error) {
    console.error('Save to Airtable error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Выход
app.get('/logout', (req, res) => {
  req.session.destroy();
  // Удаляем файл с токенами
  try {
    fs.unlinkSync(TOKENS_FILE);
  } catch (error) {
    console.error('Error deleting tokens file:', error);
  }
  res.redirect('/');
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Приложение доступно на Render.com`);
});