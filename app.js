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

// Проверка авторизации
function isAuthenticated(req, res, next) {
  if (req.session.tokens && req.session.tokens.access_token) {
    next();
  } else {
    res.redirect('/');
  }
}

// Главная страница
app.get('/', (req, res) => {
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
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.HH_CLIENT_ID,
        client_secret: process.env.HH_CLIENT_SECRET,
        redirect_uri: process.env.HH_REDIRECT_URI,
        code: code
      })
    });
    
    const tokens = await tokenResponse.json();
    
    if (tokens.error) {
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
app.get('/search', isAuthenticated, (req, res) => {
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
              <select id="area" name="area">
                <option value="1">Москва</option>
                <option value="2">Санкт-Петербург</option>
                <option value="3">Екатеринбург</option>
                <option value="4">Новосибирск</option>
                <option value="5">Нижний Новгород</option>
                <option value="66">Казань</option>
                <option value="88">Краснодар</option>
                <option value="104">Ростов-на-Дону</option>
                <option value="113">Вся Россия</option>
              </select>
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
          </div>
          
          <button type="submit">🔍 Начать поиск</button>

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
        </form>
        
        <div class="back-link">
          <a href="/">← Вернуться на главную</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Результаты поиска
app.get('/search-results', isAuthenticated, async (req, res) => {
  try {
    const searchParams = new URLSearchParams({
      text: req.query.text || '',
      area: req.query.area || '1',
      per_page: req.query.per_page || '20',
      page: req.query.page || '0',
      skills: req.query.skills_must_have || ''
    });
    
    // Добавляем опциональные параметры
    if (req.query.experience) searchParams.append('experience', req.query.experience);
    if (req.query.salary_from) searchParams.append('salary_from', req.query.salary_from);

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
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📋 Результаты поиска</h1>
          
          <div class="summary">
            <p><strong>Найдено резюме:</strong> ${data.found} | 
            <strong>Показано:</strong> ${data.items.length} | 
            <strong>Поиск:</strong> "${req.query.text}"</p>
          </div>
          
          <div class="resume-grid">
            ${data.items.map(resume => `
              <div class="resume-card">
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
                    <div class="info-value">${contact.value.formatted || contact.value}</div>
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
    
    // Извлекаем контактную информацию
    let phone = '';
    let email = '';
    
    if (resume.contact) {
      resume.contact.forEach(contact => {
        if (contact.type.id === 'cell' || contact.type.id === 'home') {
          phone = contact.value.formatted || contact.value;
        }
        if (contact.type.id === 'email') {
          email = contact.value;
        }
      });
    }
    
    // Подготавливаем данные для Airtable с правильными названиями полей
    const airtableData = {
      records: [{
        fields: {
          "Name": `${resume.last_name || ''} ${resume.first_name || ''} ${resume.middle_name || ''}`.trim(),
          "Job_Title": resume.title || '',
          "Email": email || '',
          "Phone number": phone || '',
          "resume_url": resume.alternate_url || '',
          "area": resume.area ? resume.area.name : '',
          "salary_amount": resume.salary ? resume.salary.amount : 0,
          "salary_currency": resume.salary ? resume.salary.currency : '',
          "experience_months": resume.total_experience ? resume.total_experience.months : 0,
          "age": resume.age || 0,
          "last_employer": resume.experience && resume.experience.length > 0 ? resume.experience[0].company : '',
          "education": resume.education && resume.education.primary && resume.education.primary.length > 0 
            ? `${resume.education.primary[0].name || ''} - ${resume.education.primary[0].organization || ''}` 
            : '',
          "skills": resume.skill_set && resume.skill_set.length > 0 ? resume.skill_set.join(', ') : '',
          "updated_at": new Date().toISOString().split('T')[0], // Только дата без времени
          "Hiring Status": "Candidate"
        }
      }]
    };
    
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
            <div class="details-item">Должность: ${airtableData.records[0].fields["Job_Title"]}</div>
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
  console.log(`Откройте http://localhost:${PORT} в браузере`);
});