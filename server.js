const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---------- VARIABLES DE ENTORNO ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:MiClavel23!@cluster0.96viweu.mongodb.net/?appName=Cluster0';

const USUARIO_SISTEMA = 'Sistema';
const COLORES_FIJOS = ['Rosa', 'Roja', 'Amarillo', 'Fuscia', 'Blanca', 'Bicolor', 'Naranja'];
const GRUPOS_FIJOS = ['Miristemos', 'Multiplicación', 'Raíz', 'Bioreactor'];

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => {
        console.error('❌ Error al conectar a MongoDB:', err.message);
        process.exit(1);
    });

// ---------- ESQUEMAS ----------
const ProductoSchema = new mongoose.Schema({
    color: { type: String, required: true },
    nombre: { type: String, required: true },
    fechaProceso: { type: Date, required: true },
    grupo: { type: String, required: true },
    stockMin: { type: Number, default: 0 },
    fechaCreacion: { type: Date, default: Date.now }
});

const MovimientoSchema = new mongoose.Schema({
    color: { type: String, required: true },
    nombreVariedad: { type: String, required: true },
    fecha: { type: Date, required: true },
    tipo: { type: String, required: true },
    cantidad: { type: Number, required: true },
    usuario: { type: String, default: 'Sistema' },
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
    esSistema: { type: Boolean, default: false },
    esAjuste: { type: Boolean, default: false },
    motivo: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
    observaciones: { type: String, default: '' },
    stockResultante: { type: Number, default: 0 }
});

const UsuarioSchema = new mongoose.Schema({
    nombre: { type: String, required: true, unique: true },
    horasTrabajadas: { type: Number, required: true },
    area: { type: String, required: true },
    esSistema: { type: Boolean, default: false },
    fechaRegistro: { type: Date, default: Date.now }
});

const BitacoraDiariaSchema = new mongoose.Schema({
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    fecha: { type: Date, required: true },
    horasTrabajadas: { type: Number, required: true },
    descripcion: { type: String, default: '' },
    produccion: { type: Number, default: 0 },
    movimientos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Movimiento' }],
    observaciones: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
});

BitacoraDiariaSchema.index({ usuarioId: 1, fecha: 1 }, { unique: true });

const Producto = mongoose.model('Producto', ProductoSchema);
const Movimiento = mongoose.model('Movimiento', MovimientoSchema);
const Usuario = mongoose.model('Usuario', UsuarioSchema);
const BitacoraDiaria = mongoose.model('BitacoraDiaria', BitacoraDiariaSchema);

// ---------- HELPERS DE FECHA ----------
function getInicioDiaLocal(fechaStr) {
    if (typeof fechaStr === 'string' && fechaStr.length === 10) {
        return new Date(fechaStr + 'T12:00:00');
    }
    return new Date(fechaStr);
}
function getRangoDia(fecha) {
    const base = new Date(fecha);
    const inicioDia = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0);
    const finDia = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 0);
    return [inicioDia, finDia];
}

// ---------- USUARIO SISTEMA ----------
async function asegurarUsuarioSistema() {
    try {
        let sis = await Usuario.findOne({ esSistema: true });
        if (!sis) {
            sis = new Usuario({
                nombre: USUARIO_SISTEMA,
                horasTrabajadas: 0,
                area: 'Inventario Base',
                esSistema: true
            });
            await sis.save();
            console.log('✅ Usuario Sistema creado');
        }
    } catch (error) {
        console.error('Error creando usuario Sistema:', error.message);
    }
}

// ---------- CALCULAR STOCK ----------
async function calcularStock(color, nombreVariedad) {
    try {
        const movimientos = await Movimiento.find({ color, nombreVariedad });
        let cantidad = 0;
        for (const mov of movimientos) {
            const tipo = mov.tipo;
            const cant = mov.cantidad || 0;
            if (tipo === "Ingreso") cantidad += cant;
            else if (tipo === "Ajuste") cantidad += cant;
            else if (tipo.startsWith("Traspaso a")) cantidad -= cant;
        }
        return Math.round(cantidad * 100) / 100;
    } catch (error) {
        return 0;
    }
}

// ---------- ENDPOINTS PÚBLICOS ----------
app.get('/api/colores', async (req, res) => {
    try {
        const colores = await Producto.distinct('color');
        const pred = COLORES_FIJOS;
        res.json((colores.length > 0 ? colores : pred).sort());
    } catch (error) {
        res.json(COLORES_FIJOS);
    }
});

app.get('/api/variedades', async (req, res) => {
    try {
        const color = req.query.color;
        if (!color) return res.json([]);
        const productos = await Producto.find({ color });
        res.json(productos.map(p => p.nombre).sort());
    } catch (error) {
        res.status(500).json([]);
    }
});

app.post('/api/productos', async (req, res) => {
    try {
        const { color, nombre, fechaProceso, grupo } = req.body;
        if (!color || !nombre || !fechaProceso || !grupo) return res.status(400).json('Todos los campos son obligatorios.');
        const existe = await Producto.findOne({ color, nombre });
        if (existe) return res.status(400).json('Ya existe este producto con el mismo color y nombre.');
        const fechaObj = getInicioDiaLocal(fechaProceso);
        if (isNaN(fechaObj.getTime())) return res.status(400).json('Fecha inválida.');
        const nuevo = new Producto({ color, nombre, fechaProceso: fechaObj, grupo, stockMin: 0 });
        await nuevo.save();
        res.json('Producto registrado correctamente.');
    } catch (error) {
        res.status(500).json(`Error: ${error.message}`);
    }
});

app.get('/api/productos', async (req, res) => {
    try {
        const productos = await Producto.find({});
        const resultado = [];
        for (const p of productos) {
            const stock = await calcularStock(p.color, p.nombre);
            resultado.push({ _id: p._id, color: p.color, nombre: p.nombre, fechaProceso: p.fechaProceso, grupo: p.grupo, stockMin: p.stockMin || 0, stock });
        }
        res.json(resultado);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/api/buscar', async (req, res) => {
    try {
        const texto = req.query.q || '';
        if (texto.length < 1) return res.json([]);
        const busq = texto.toLowerCase().trim();
        const productos = await Producto.find({
            $or: [
                { color: { $regex: busq, $options: 'i' } },
                { nombre: { $regex: busq, $options: 'i' } },
                { grupo: { $regex: busq, $options: 'i' } }
            ]
        });
        const resultado = [];
        for (const p of productos) {
            const stock = await calcularStock(p.color, p.nombre);
            resultado.push({ color: p.color, nombre: p.nombre, fechaProceso: p.fechaProceso, grupo: p.grupo, stockMin: p.stockMin || 0, stock });
        }
        res.json(resultado);
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/api/stock', async (req, res) => {
    try {
        const productos = await Producto.find({});
        const stock = [];
        for (const p of productos) {
            const cantidad = await calcularStock(p.color, p.nombre);
            stock.push({ color: p.color, nombre: p.nombre, fechaProceso: p.fechaProceso, grupo: p.grupo, stockMin: p.stockMin || 0, cantidad });
        }
        res.json(stock.sort((a, b) => a.nombre.localeCompare(b.nombre)));
    } catch (error) {
        res.status(500).json([]);
    }
});

app.post('/api/movimientos', async (req, res) => {
    try {
        const { color, nombre, fecha, tipo, cantidad, observaciones, usuarioId } = req.body;
        if (!color || !nombre || !fecha || !tipo || !cantidad) return res.status(400).json('Todos los campos son obligatorios.');
        const cant = parseFloat(cantidad);
        if (cant <= 0) return res.status(400).json('La cantidad debe ser mayor a 0.');
        const producto = await Producto.findOne({ color, nombre });
        if (!producto) return res.status(400).json('El producto no existe.');
        const stockActual = await calcularStock(color, nombre);
        if (tipo.startsWith("Traspaso a") && stockActual < cant) {
            return res.status(400).json(`Stock insuficiente. Disponible: ${stockActual}`);
        }
        let stockResultante = stockActual;
        if (tipo === "Ingreso") stockResultante += cant;
        else if (tipo.startsWith("Traspaso a")) stockResultante -= cant;
        const fechaObj = getInicioDiaLocal(fecha);
        let nombreUsuario = 'Sistema';
        let usuario = null;
        if (usuarioId) {
            usuario = await Usuario.findById(usuarioId);
            if (usuario) nombreUsuario = usuario.nombre;
        }
        const nuevoMovimiento = new Movimiento({
            color, nombreVariedad: nombre, fecha: fechaObj, tipo, cantidad: cant,
            usuario: nombreUsuario, usuarioId: usuarioId || null,
            esSistema: false, esAjuste: false,
            observaciones: observaciones || '', stockResultante
        });
        await nuevoMovimiento.save();
        if (tipo.startsWith("Traspaso a")) {
            let nuevoGrupo = "";
            if (tipo === "Traspaso a raíz") nuevoGrupo = "Raíz";
            else if (tipo === "Traspaso a Multi") nuevoGrupo = "Multiplicación";
            else if (tipo === "Traspaso a invernadero") nuevoGrupo = "Invernadero";
            if (nuevoGrupo) await Producto.findOneAndUpdate({ color, nombre }, { grupo: nuevoGrupo });
        }
        if (usuario && !usuario.esSistema) {
            const [inicioDia, finDia] = getRangoDia(fechaObj);
            let bitacora = await BitacoraDiaria.findOne({
                usuarioId: usuario._id,
                fecha: { $gte: inicioDia, $lt: finDia }
            });
            if (!bitacora) {
                bitacora = new BitacoraDiaria({
                    usuarioId: usuario._id, fecha: inicioDia,
                    horasTrabajadas: usuario.horasTrabajadas,
                    descripcion: '', produccion: 0, movimientos: [], observaciones: ''
                });
            }
            bitacora.movimientos.push(nuevoMovimiento._id);
            await bitacora.save();
        }
        res.json('Movimiento registrado correctamente.');
    } catch (error) {
        res.status(500).json(`Error: ${error.message}`);
    }
});

// ---------- INVENTARIO INICIAL ----------
app.post('/api/admin/inventario-inicial', async (req, res) => {
    try {
        const { password, color, nombre, fechaProceso, grupo, cantidad } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
        if (!color || !nombre || !fechaProceso || !grupo || !cantidad) return res.status(400).json({ error: 'Todos los campos son obligatorios.' });
        const cant = parseFloat(cantidad);
        if (cant <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0.' });

        await asegurarUsuarioSistema();
        const usuarioSistema = await Usuario.findOne({ esSistema: true });

        let producto = await Producto.findOne({ color, nombre });
        if (!producto) {
            const fechaObjProd = getInicioDiaLocal(fechaProceso);
            producto = new Producto({ color, nombre, fechaProceso: fechaObjProd, grupo, stockMin: 0 });
            await producto.save();
        } else {
            if (producto.grupo !== grupo) {
                producto.grupo = grupo;
                await producto.save();
            }
        }

        const stockActual = await calcularStock(color, nombre);
        const stockResultante = stockActual + cant;
        const fechaObj = getInicioDiaLocal(fechaProceso);

        const nuevoMovimiento = new Movimiento({
            color, nombreVariedad: nombre, fecha: fechaObj, tipo: 'Ingreso', cantidad: cant,
            usuario: USUARIO_SISTEMA, usuarioId: usuarioSistema._id,
            esSistema: true, esAjuste: false,
            observaciones: 'Inventario inicial (carga del admin)', stockResultante
        });
        await nuevoMovimiento.save();
        res.json({ mensaje: `Inventario inicial cargado: ${cant} unidades de ${color}-${nombre}`, movimientoId: nuevoMovimiento._id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------- HISTORIAL ----------
app.get('/api/historial', async (req, res) => {
    try {
        const { desde, hasta, tipo: tipoFiltro } = req.query;
        if (!desde || !hasta) return res.json([]);
        const fechaDesde = getInicioDiaLocal(desde);
        fechaDesde.setHours(0, 0, 0, 0);
        const fechaHasta = getInicioDiaLocal(hasta);
        fechaHasta.setHours(23, 59, 59, 999);
        const filtros = { fecha: { $gte: fechaDesde, $lte: fechaHasta } };
        if (tipoFiltro) filtros.tipo = tipoFiltro;
        const movimientos = await Movimiento.find(filtros).sort({ fecha: -1 });
        res.json(movimientos.map(m => ({
            color: m.color, nombre: m.nombreVariedad, fecha: m.fecha.toLocaleDateString('es-ES'),
            tipo: m.tipo, cantidad: m.cantidad,
            observaciones: m.observaciones || '',
            usuario: m.esSistema ? 'Sistema (Inventario Inicial)' : (m.esAjuste ? 'Admin (Ajuste)' : (m.usuario || 'N/A'))
        })));
    } catch (error) {
        res.status(500).json([]);
    }
});

app.get('/api/resumen', async (req, res) => {
    try {
        const totalProductos = await Producto.countDocuments();
        const totalMovimientos = await Movimiento.countDocuments();
        const productos = await Producto.find({});
        let sinStock = 0, stockBajo = 0;
        for (const p of productos) {
            const stock = await calcularStock(p.color, p.nombre);
            if (stock <= 0) sinStock++;
            else if (stock <= p.stockMin && p.stockMin > 0) stockBajo++;
        }
        const fechaUnMes = new Date();
        fechaUnMes.setMonth(fechaUnMes.getMonth() - 1);
        const movUltimoMes = await Movimiento.countDocuments({ fecha: { $gte: fechaUnMes } });
        res.json({ totalProductos, totalMovimientos, sinStock, stockBajo, valorTotalInventario: 0, movimientosUltimoMes: movUltimoMes });
    } catch (error) {
        res.status(500).json({ totalProductos: 0, totalMovimientos: 0, sinStock: 0, stockBajo: 0 });
    }
});

app.get('/api/exportar-stock', async (req, res) => {
    try {
        const productos = await Producto.find({});
        let csv = '\uFEFFColor,Nombre,Fecha Proceso,Grupo,Stock\n';
        for (const p of productos) {
            const stock = await calcularStock(p.color, p.nombre);
            csv += `"${p.color}","${p.nombre}","${p.fechaProceso.toLocaleDateString('es-ES')}","${p.grupo}",${stock}\n`;
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=inventario_exportado.csv');
        res.send(csv);
    } catch (error) {
        res.status(500).send('Error al exportar');
    }
});

app.get('/api/validar', async (req, res) => {
    try {
        const errores = [];
        const productos = await Producto.find({});
        const vistos = new Set();
        for (const p of productos) {
            const clave = `${p.color}-${p.nombre}`;
            if (vistos.has(clave)) errores.push(`Duplicado: ${p.color} - ${p.nombre}`);
            vistos.add(clave);
        }
        res.json({ errores: errores.length ? errores : ['Todos los datos están correctos.'] });
    } catch (error) {
        res.status(500).json({ errores: ['Error al validar'] });
    }
});

// ---------- USUARIOS ----------
app.post('/api/usuarios', async (req, res) => {
    try {
        const { nombre, horasTrabajadas, area } = req.body;
        if (!nombre || !horasTrabajadas || !area) return res.status(400).json('Todos los campos son obligatorios.');
        const existe = await Usuario.findOne({ nombre });
        if (existe) return res.status(400).json('Este nombre de usuario ya está registrado.');
        const nuevo = new Usuario({ nombre, horasTrabajadas, area });
        await nuevo.save();
        res.json({ mensaje: 'Usuario registrado correctamente', usuario: nuevo });
    } catch (error) {
        res.status(500).json(`Error: ${error.message}`);
    }
});

app.get('/api/usuarios', async (req, res) => {
    try {
        res.json(await Usuario.find({ esSistema: { $ne: true } }).sort({ nombre: 1 }));
    } catch (error) {
        res.status(500).json([]);
    }
});

// ---------- BITÁCORA ----------
app.get('/api/bitacora/:usuarioId', async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const fechaStr = req.query.fecha || new Date().toISOString().split('T')[0];
        const fecha = getInicioDiaLocal(fechaStr);
        const [inicioDia, finDia] = getRangoDia(fecha);
        const bitacora = await BitacoraDiaria.findOne({
            usuarioId, fecha: { $gte: inicioDia, $lt: finDia }
        }).populate('usuarioId').populate('movimientos');
        res.json(bitacora || null);
    } catch (error) {
        res.status(500).json(null);
    }
});

app.patch('/api/bitacora/:usuarioId', async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const { descripcion, produccion } = req.body;
        const fechaStr = req.query.fecha || new Date().toISOString().split('T')[0];
        const fecha = getInicioDiaLocal(fechaStr);
        const [inicioDia, finDia] = getRangoDia(fecha);

        if (descripcion === undefined && produccion === undefined) return res.status(400).json('Debe enviar datos.');

        let bitacora = await BitacoraDiaria.findOne({
            usuarioId, fecha: { $gte: inicioDia, $lt: finDia }
        });
        if (!bitacora) {
            const usuario = await Usuario.findById(usuarioId);
            if (!usuario) return res.status(404).json('Usuario no encontrado.');
            bitacora = new BitacoraDiaria({
                usuarioId: usuario._id, fecha: inicioDia,
                horasTrabajadas: usuario.horasTrabajadas,
                descripcion: descripcion || '', produccion: produccion || 0,
                movimientos: [], observaciones: ''
            });
        } else {
            if (descripcion !== undefined) bitacora.descripcion = descripcion;
            if (produccion !== undefined) bitacora.produccion = produccion;
        }
        await bitacora.save();
        res.json({ mensaje: 'Bitácora actualizada correctamente', bitacora });
    } catch (error) {
        res.status(500).json(`Error: ${error.message}`);
    }
});

app.get('/api/bitacoras', async (req, res) => {
    try {
        const fechaStr = req.query.fecha || new Date().toISOString().split('T')[0];
        const fecha = getInicioDiaLocal(fechaStr);
        const [inicioDia, finDia] = getRangoDia(fecha);
        const bitacoras = await BitacoraDiaria.find({
            fecha: { $gte: inicioDia, $lt: finDia }
        }).populate('usuarioId').populate('movimientos');
        res.json(bitacoras);
    } catch (error) {
        res.status(500).json([]);
    }
});

// ---------- ADMIN: TODO EN UNO ----------
app.get('/api/admin/todo', async (req, res) => {
    try {
        const { password, limite } = req.query;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const todas = await BitacoraDiaria.find({})
            .sort({ fecha: -1, timestamp: -1 })
            .populate('usuarioId')
            .populate('movimientos');

        const todasLimpias = todas.filter(b => b.usuarioId && !b.usuarioId.esSistema);

        const limiteNum = parseInt(limite) || 200;
        const lista = todasLimpias.slice(0, limiteNum);

        const calcularNivel = (produccion) => {
            if (produccion < 700) return { nivel: 'Crítico', nivelClass: 'status-critical' };
            if (produccion < 800) return { nivel: 'Normal', nivelClass: 'status-normal' };
            if (produccion <= 1000) return { nivel: 'Óptimo', nivelClass: 'status-optimal' };
            return { nivel: 'Mejor', nivelClass: 'status-best' };
        };

        const bitacoras = lista.map(bit => {
            const produccion = bit.produccion || 0;
            const { nivel, nivelClass } = calcularNivel(produccion);
            return {
                _id: bit._id,
                fecha: bit.fecha,
                fechaStr: bit.fecha.toLocaleDateString('es-ES'),
                usuario: bit.usuarioId ? bit.usuarioId.nombre : 'Usuario desconocido',
                area: bit.usuarioId ? bit.usuarioId.area : '',
                horas: bit.horasTrabajadas || 0,
                produccion, nivel, nivelClass,
                movimientos: bit.movimientos ? bit.movimientos.length : 0,
                descripcion: bit.descripcion || 'Sin descripción',
                observaciones: bit.observaciones || ''
            };
        });

        const totalProduccion = bitacoras.reduce((s, b) => s + b.produccion, 0);
        const promedio = bitacoras.length > 0 ? Math.round(totalProduccion / bitacoras.length) : 0;

        const fechaMasReciente = todasLimpias.length > 0 ? todasLimpias[0].fecha : null;
        let kpisHoy = { total: 0, promedio: 0, mejor: null, menor: null };
        if (fechaMasReciente) {
            const [ini, fin] = getRangoDia(fechaMasReciente);
            const delDia = todasLimpias.filter(b => b.fecha >= ini && b.fecha < fin);
            if (delDia.length > 0) {
                const totales = delDia.map(b => ({
                    usuario: b.usuarioId ? b.usuarioId.nombre : 'Desconocido',
                    produccion: b.produccion || 0
                }));
                kpisHoy.total = totales.reduce((s, x) => s + x.produccion, 0);
                kpisHoy.promedio = Math.round(kpisHoy.total / totales.length);
                kpisHoy.mejor = totales.reduce((max, x) => x.produccion > max.produccion ? x : max, totales[0]);
                kpisHoy.menor = totales.reduce((min, x) => x.produccion < min.produccion ? x : min, totales[0]);
            }
        }

        let datosBarras = { labels: [], producciones: [], colores: [] };
        if (fechaMasReciente) {
            const [ini, fin] = getRangoDia(fechaMasReciente);
            const delDia = todasLimpias.filter(b => b.fecha >= ini && b.fecha < fin);
            datosBarras.labels = delDia.map(b => b.usuarioId ? b.usuarioId.nombre : 'Desconocido');
            datosBarras.producciones = delDia.map(b => b.produccion || 0);
            datosBarras.colores = delDia.map(b => {
                const { nivel } = calcularNivel(b.produccion || 0);
                if (nivel === 'Crítico') return '#dc3545';
                if (nivel === 'Normal') return '#ffc107';
                if (nivel === 'Óptimo') return '#28a745';
                return '#5DADE2';
            });
        }

        const conteoNiveles = { 'Crítico': 0, 'Normal': 0, 'Óptimo': 0, 'Mejor': 0 };
        bitacoras.forEach(b => { conteoNiveles[b.nivel]++; });

        const hoy = new Date();
        const tendencia = [];
        for (let i = 6; i >= 0; i--) {
            const fecha = new Date(hoy);
            fecha.setDate(fecha.getDate() - i);
            const [ini, fin] = getRangoDia(fecha);
            const delDia = todasLimpias.filter(b => b.fecha >= ini && b.fecha < fin);
            const totalDia = delDia.reduce((s, b) => s + (b.produccion || 0), 0);
            const promDia = delDia.length > 0 ? Math.round(totalDia / delDia.length) : 0;
            tendencia.push({
                fecha: ini.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }),
                total: totalDia,
                promedio: promDia,
                trabajadores: delDia.length
            });
        }

        const productos = await Producto.find({}).sort({ color: 1, nombre: 1 });
        const listaProductos = [];
        for (const p of productos) {
            const stock = await calcularStock(p.color, p.nombre);
            const numMovs = await Movimiento.countDocuments({ color: p.color, nombreVariedad: p.nombre });
            listaProductos.push({
                _id: p._id, color: p.color, nombre: p.nombre, grupo: p.grupo,
                fechaProceso: p.fechaProceso, stock: stock, numMovimientos: numMovs
            });
        }

        res.json({
            bitacoras,
            totalBitacoras: todasLimpias.length,
            kpis: { totalProduccion, promedio, fechaMasReciente: fechaMasReciente ? fechaMasReciente.toLocaleDateString('es-ES') : null, kpisHoy },
            datosBarras, conteoNiveles, tendencia,
            productos: listaProductos
        });
    } catch (error) {
        console.error('Error en /api/admin/todo:', error);
        res.status(500).json({ error: error.message });
    }
});

// ---------- ADMIN: EDITAR PRODUCTO ----------
app.post('/api/admin/editar-producto', async (req, res) => {
    try {
        const { password, productoId, nuevoColor, nuevoNombre, nuevoGrupo } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
        if (!productoId) return res.status(400).json({ error: 'Producto no especificado.' });

        const producto = await Producto.findById(productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });

        const colorViejo = producto.color;
        const nombreViejo = producto.nombre;

        if (nuevoColor && !COLORES_FIJOS.includes(nuevoColor)) return res.status(400).json({ error: 'Color no permitido.' });
        if (nuevoGrupo && !GRUPOS_FIJOS.includes(nuevoGrupo)) return res.status(400).json({ error: 'Grupo no permitido.' });

        const colorFinal = nuevoColor || producto.color;
        const nombreFinal = nuevoNombre && nuevoNombre.trim() ? nuevoNombre.trim() : producto.nombre;
        const grupoFinal = nuevoGrupo || producto.grupo;

        if (colorFinal !== colorViejo || nombreFinal !== nombreViejo) {
            const duplicado = await Producto.findOne({ color: colorFinal, nombre: nombreFinal, _id: { $ne: productoId } });
            if (duplicado) return res.status(400).json({ error: 'Ya existe otro producto con ese color y nombre.' });
        }

        producto.color = colorFinal;
        producto.nombre = nombreFinal;
        producto.grupo = grupoFinal;
        await producto.save();

        if (colorFinal !== colorViejo || nombreFinal !== nombreViejo) {
            await Movimiento.updateMany(
                { color: colorViejo, nombreVariedad: nombreViejo },
                { $set: { color: colorFinal, nombreVariedad: nombreFinal } }
            );
        }

        res.json({ mensaje: 'Producto actualizado correctamente.', producto });
    } catch (error) {
        console.error('Error en editar-producto:', error);
        res.status(500).json({ error: error.message });
    }
});

// ---------- ADMIN: AJUSTAR STOCK ----------
app.post('/api/admin/ajustar-stock', async (req, res) => {
    try {
        const { password, productoId, cantidad, motivo } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
        if (!productoId) return res.status(400).json({ error: 'Producto no especificado.' });
        const cant = parseFloat(cantidad);
        if (isNaN(cant) || cant === 0) return res.status(400).json({ error: 'La cantidad debe ser diferente de 0.' });
        if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo es obligatorio.' });

        const producto = await Producto.findById(productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });

        await asegurarUsuarioSistema();
        const usuarioSistema = await Usuario.findOne({ esSistema: true });

        const stockActual = await calcularStock(producto.color, producto.nombre);
        const stockResultante = stockActual + cant;

        const nuevoMovimiento = new Movimiento({
            color: producto.color,
            nombreVariedad: producto.nombre,
            fecha: new Date(),
            tipo: 'Ajuste',
            cantidad: cant,
            usuario: 'Admin (Ajuste)',
            usuarioId: usuarioSistema._id,
            esSistema: true,
            esAjuste: true,
            motivo: motivo.trim(),
            observaciones: `Ajuste manual: ${motivo.trim()}`,
            stockResultante
        });
        await nuevoMovimiento.save();

        res.json({ mensaje: `Stock ajustado: ${cant > 0 ? '+' : ''}${cant} unidades. Nuevo stock: ${stockResultante}`, movimientoId: nuevoMovimiento._id });
    } catch (error) {
        console.error('Error en ajustar-stock:', error);
        res.status(500).json({ error: error.message });
    }
});

// ---------- ADMIN: ELIMINAR PRODUCTO ----------
app.post('/api/admin/eliminar-producto', async (req, res) => {
    try {
        const { password, productoId } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
        if (!productoId) return res.status(400).json({ error: 'Producto no especificado.' });

        const producto = await Producto.findById(productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });

        const numMovs = await Movimiento.countDocuments({ color: producto.color, nombreVariedad: producto.nombre });
        if (numMovs > 0) {
            return res.status(400).json({ error: `No se puede eliminar: tiene ${numMovs} movimiento(s) asociados. Solo se puede editar.` });
        }

        await Producto.findByIdAndDelete(productoId);
        res.json({ mensaje: 'Producto eliminado correctamente.' });
    } catch (error) {
        console.error('Error en eliminar-producto:', error);
        res.status(500).json({ error: error.message });
    }
});

// ---------- ADMIN: RESET TOTAL ----------
app.post('/api/admin/reset-total', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const rProductos = await Producto.deleteMany({});
        const rMovimientos = await Movimiento.deleteMany({});
        const rBitacoras = await BitacoraDiaria.deleteMany({});
        const rUsuarios = await Usuario.deleteMany({ esSistema: { $ne: true } });

        res.json({
            mensaje: 'Sistema reseteado completamente.',
            resultados: {
                productos: rProductos.deletedCount,
                movimientos: rMovimientos.deletedCount,
                usuarios: rUsuarios.deletedCount,
                bitacoras: rBitacoras.deletedCount
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------- ARRANQUE ----------
app.listen(PORT, '0.0.0.0', async () => {
    await asegurarUsuarioSistema();
    console.log(`✅ Servidor corriendo en el puerto ${PORT}`);
    console.log(`🔐 Admin password configurado: ${ADMIN_PASSWORD === 'admin123' ? 'admin123 (por defecto)' : '(personalizado)'}`);
});