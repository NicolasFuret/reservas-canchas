// ===============================
//  SERVER.JS - FÚTBOL TOTAL
//  Sistema de reservas con:
//  ✔ Login administrador
//  ✔ Bloqueo de horarios ocupados
//  ✔ Horarios dinámicos
//  ✔ Envío de correos (cliente + admin)
//  ✔ Panel admin protegido
//  ✔ Eliminar reservas
//  ✔ Base de datos SQLite
// ===============================

require('dotenv').config();
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const nodemailer = require('nodemailer');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;

// -------------------------------
// MIDDLEWARES
// -------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------
// CONFIGURAR SESIÓN
// -------------------------------
app.use(session({
  secret: 'clave-super-secreta-123',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// -------------------------------
// BASE DE DATOS SQLITE
// -------------------------------
const db = new sqlite3.Database('./reservas.db', (err) => {
  if (err) {
    console.error('❌ Error al conectar con la base de datos:', err);
  } else {
    console.log('✔️ Base de datos SQLite conectada');
  }
});

// Crear tabla si no existe
db.run(`
  CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL,
    telefono TEXT,
    fecha TEXT NOT NULL,
    hora TEXT NOT NULL,
    cancha TEXT NOT NULL,
    comentario TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`, (err) => {
  if (err) {
    console.error('❌ Error al crear la tabla reservas:', err);
  } else {
    console.log('✔️ Tabla reservas lista');
  }
});

// -------------------------------
// CONFIGURACIÓN DE CORREO
// -------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// -------------------------------
// LOGIN ADMIN
// -------------------------------
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const { usuario, password } = req.body;

  const ADMIN_USER = "admin";
  const ADMIN_PASS = "1234";

  if (usuario === ADMIN_USER && password === ADMIN_PASS) {
    req.session.admin = true;
    return res.redirect('/admin/reservas');
  }

  return res.send(`
    <p style="color:red; text-align:center; margin-top:20px;">Credenciales incorrectas</p>
    <script>setTimeout(()=>{ window.location.href='/admin/login' }, 1500)</script>
  `);
});

// -------------------------------
// LOGOUT ADMIN
// -------------------------------
app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// -------------------------------
// CREAR RESERVA + CORREO
// -------------------------------
app.post('/api/reservas', (req, res) => {
  const { nombre, email, telefono, fecha, hora, cancha, comentario } = req.body;

  if (!nombre || !email || !fecha || !hora || !cancha) {
    return res.status(400).json({ ok: false, message: 'Faltan datos obligatorios' });
  }

  const sqlCheck = `
    SELECT * FROM reservas
    WHERE fecha = ? AND hora = ? AND cancha = ?
  `;

  db.get(sqlCheck, [fecha, hora, cancha], (err, reservaExistente) => {
    if (err) return res.status(500).json({ ok: false, message: 'Error al validar disponibilidad' });

    if (reservaExistente) {
      return res.status(409).json({ ok: false, message: 'Este horario ya está reservado para esta cancha.' });
    }

    const sqlInsert = `
      INSERT INTO reservas (nombre, email, telefono, fecha, hora, cancha, comentario)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sqlInsert, [nombre, email, telefono || '', fecha, hora, cancha, comentario || ''], function (err) {
      if (err) return res.status(500).json({ ok: false, message: 'Error al guardar la reserva' });

      const reservaId = this.lastID;

      const mailOptions = {
        from: process.env.FROM_EMAIL,
        to: `${email}, ${process.env.TO_EMAIL}`,
        subject: `Confirmación de reserva #${reservaId} - Fútbol Total`,
        html: `
          <h2>Confirmación de tu Reserva</h2>
          <p>Hola <strong>${nombre}</strong>, tu reserva se registró correctamente.</p>
          <ul>
            <li><strong>Cancha:</strong> ${cancha}</li>
            <li><strong>Fecha:</strong> ${fecha}</li>
            <li><strong>Hora:</strong> ${hora}</li>
            <li><strong>Teléfono:</strong> ${telefono || 'No informado'}</li>
          </ul>
          <p>Gracias por reservar con <strong>Fútbol Total</strong>.</p>
        `
      };

      transporter.sendMail(mailOptions, (error) => {
        if (error) console.error('⚠️ Error al enviar correo:', error);

        res.status(201).json({
          ok: true,
          id: reservaId,
          message: 'Reserva creada y correo enviado correctamente.'
        });
      });
    });
  });
});

// -------------------------------
// HORAS OCUPADAS
// -------------------------------
app.get('/api/horas-ocupadas', (req, res) => {
  const { fecha, cancha } = req.query;

  const sql = `SELECT hora FROM reservas WHERE fecha = ? AND cancha = ?`;

  db.all(sql, [fecha, cancha], (err, filas) => {
    if (err) return res.status(500).json({ ok: false });
    res.json({ ok: true, horas: filas.map(f => f.hora) });
  });
});

// -------------------------------
// ELIMINAR RESERVA (ADMIN)
// -------------------------------
app.get('/admin/eliminar/:id', (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');

  const reservaId = req.params.id;

  db.run("DELETE FROM reservas WHERE id = ?", [reservaId], function (err) {
    if (err) {
      console.error('❌ Error al eliminar reserva:', err);
      return res.status(500).send("Error al eliminar la reserva");
    }

    console.log(`✔️ Reserva eliminada: #${reservaId}`);
    res.redirect('/admin/reservas');
  });
});

// -------------------------------
// PANEL ADMIN
// -------------------------------
app.get('/admin/reservas', (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');

  db.all("SELECT * FROM reservas ORDER BY fecha, hora", [], (err, filas) => {
    if (err) return res.status(500).send("Error al obtener reservas");

    let html = `
      <html>
      <head>
        <meta charset="UTF-8"/>
        <title>Reservas</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-900 text-white">
        <div class="max-w-5xl mx-auto p-6">
          <div class="flex justify-between">
            <h1 class="text-3xl font-bold">Listado de Reservas</h1>
            <a href="/admin/logout" class="text-red-400 hover:text-red-300">Cerrar sesión</a>
          </div>
          <table class="w-full mt-4 bg-slate-950 border border-slate-700">
            <thead class="bg-slate-800">
              <tr>
                <th class="py-2 px-3">ID</th>
                <th class="py-2 px-3">Nombre</th>
                <th class="py-2 px-3">Email</th>
                <th class="py-2 px-3">Fecha</th>
                <th class="py-2 px-3">Hora</th>
                <th class="py-2 px-3">Cancha</th>
                <th class="py-2 px-3">Teléfono</th>
                <th class="py-2 px-3">Comentario</th>
                <th class="py-2 px-3">Creado</th>
                <th class="py-2 px-3">Acción</th>
              </tr>
            </thead>
            <tbody>
    `;

    filas.forEach(r => {
      html += `
        <tr class="border-t border-slate-700">
          <td class="py-2 px-3 text-xs">${r.id}</td>
          <td class="py-2 px-3 text-xs">${r.nombre}</td>
          <td class="py-2 px-3 text-xs">${r.email}</td>
          <td class="py-2 px-3 text-xs">${r.fecha}</td>
          <td class="py-2 px-3 text-xs">${r.hora}</td>
          <td class="py-2 px-3 text-xs">${r.cancha}</td>
          <td class="py-2 px-3 text-xs">${r.telefono}</td>
          <td class="py-2 px-3 text-xs">${r.comentario}</td>
          <td class="py-2 px-3 text-xs">${r.created_at}</td>
          <td class="py-2 px-3 text-xs">
            <a href="/admin/eliminar/${r.id}" 
              onclick="return confirm('¿Eliminar esta reserva?');"
              class="text-red-400 hover:text-red-300">
              Eliminar
            </a>
          </td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// -------------------------------
// INICIAR SERVIDOR
// -------------------------------
app.listen(PORT, () => {
  console.log(`✔️ Servidor corriendo en http://localhost:${PORT}`);
});
