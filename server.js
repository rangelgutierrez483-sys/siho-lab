const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:MiClavel23!@cluster0.96viweu.mongodb.net/?appName=Cluster0';
const USUARIO_SISTEMA = 'Sistema';
const COLORES_FIJOS = ['Rosa', 'Roja', 'Amarillo', 'Fuscia', 'Blanca', 'Bicolor', 'Naranja'];
const GRUPOS_TODOS = ['Miristemos', 'Bioreactor', 'Multiplicación', 'Raíz', 'Planta Lavada', 'Invernadero'];
const SUBDIVISIONES_PLANTA_LAVADA = ['Grande', 'Mediana', 'Chica', 'Sin Raíz'];
const FLUJO_TRASPASOS = {
    'Miristemos': ['Bioreactor'],
    'Bioreactor': ['Multiplicación', 'Raíz'],
    'Multiplicación': ['Raíz'],
    'Raíz': ['Planta Lavada'],
    'Planta Lavada': ['Invernadero'],
    'Invernadero': []
};

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => { console.error('❌ Error al conectar:', err.message); process.exit(1); });

const ProductoSchema = new mongoose.Schema({
    color: { type: String, required: true },
    nombre: { type: String, required: true },
    fechaProceso: { type: Date, required: true },
    grupo: { type: String, required: true },
    stockMin: { type: Number, default: 0 },
    fechaCreacion: { type: Date, default: Date.now }
});
ProductoSchema.index({ color: 1, nombre: 1 }, { unique: true });

const MovimientoSchema = new mongoose.Schema({
    color: { type: String, required: true },
    nombreVariedad: { type: String, required: true },
    fecha: { type: Date, required: true },
    tipo: { type: String, required: true },
    grupoOrigen: { type: String, default: '' },
    grupoDestino: { type: String, default: '' },
    cantidadFrascos: { type: Number, default: 0 },
    subdivisiones: {
        grande: { type: Number, default: 0 },
        mediana: { type: Number, default: 0 },
        chica: { type: Number, default: 0 },
        sinRaiz: { type: Number, default: 0 }
    },
    totalPlantas: { type: Number, default: 0 },
    subdivisionOrigen: { type: String, default: '' },
    cantidad: { type: Number, default: 0 },
    usuario: { type: String, default: 'Sistema' },
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null },
    esSistema: { type: Boolean, default: false },
    esAjuste: { type: Boolean, default: false },
    motivo: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
    observaciones: { type: String, default: '' }
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
    observaciones: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
});
BitacoraDiariaSchema.index({ usuarioId: 1, fecha: 1 }, { unique: true });

const Producto = mongoose.model('Producto', ProductoSchema);
const Movimiento = mongoose.model('Movimiento', MovimientoSchema);
const Usuario = mongoose.model('Usuario', UsuarioSchema);
const BitacoraDiaria = mongoose.model('BitacoraDiaria', BitacoraDiariaSchema);

function getInicioDiaLocal(fechaStr) {
    if (typeof fechaStr === 'string' && fechaStr.length === 10) return new Date(fechaStr + 'T12:00:00');
    return new Date(fechaStr);
}
function getRangoDia(fecha) {
    const base = new Date(fecha);
    return [
        new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0),
        new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 0, 0, 0)
    ];
}

async function asegurarUsuarioSistema() {
    try {
        let sis = await Usuario.findOne({ esSistema: true });
        if (!sis) {
            sis = new Usuario({ nombre: USUARIO_SISTEMA, horasTrabajadas: 0, area: 'Inventario Base', esSistema: true });
            await sis.save();
            console.log('✅ Usuario Sistema creado');
        }
    } catch (error) { console.error('Error creando Sistema:', error.message); }
}

// ==================== CÁLCULO OPTIMIZADO DE STOCK ====================

function calcularStockDesdeMovimientos(movs, grupo) {
    if (grupo === 'Planta Lavada') {
        let grande = 0, mediana = 0, chica = 0, sinRaiz = 0;
        for (const mov of movs) {
            if ((mov.tipo === 'Ingreso' || mov.tipo === 'Traspaso') && mov.grupoDestino === 'Planta Lavada') {
                grande += (mov.subdivisiones && mov.subdivisiones.grande) || 0;
                mediana += (mov.subdivisiones && mov.subdivisiones.mediana) || 0;
                chica += (mov.subdivisiones && mov.subdivisiones.chica) || 0;
                sinRaiz += (mov.subdivisiones && mov.subdivisiones.sinRaiz) || 0;
            }
            if (mov.tipo === 'Traspaso' && mov.grupoOrigen === 'Planta Lavada') {
                if (mov.subdivisiones) {
                    grande -= mov.subdivisiones.grande || 0;
                    mediana -= mov.subdivisiones.mediana || 0;
                    chica -= mov.subdivisiones.chica || 0;
                    sinRaiz -= mov.subdivisiones.sinRaiz || 0;
                }
                if (mov.subdivisionOrigen && mov.cantidad) {
                    if (mov.subdivisionOrigen === 'Grande') grande -= mov.cantidad;
                    else if (mov.subdivisionOrigen === 'Mediana') mediana -= mov.cantidad;
                    else if (mov.subdivisionOrigen === 'Chica') chica -= mov.cantidad;
                    else if (mov.subdivisionOrigen === 'Sin Raíz') sinRaiz -= mov.cantidad;
                }
            }
        }
        return {
            grande: Math.max(0, grande),
            mediana: Math.max(0, mediana),
            chica: Math.max(0, chica),
            sinRaiz: Math.max(0, sinRaiz),
            total: Math.max(0, grande + mediana + chica + sinRaiz)
        };
    }

    let cantidad = 0;
    for (const mov of movs) {
        if (mov.tipo === 'Ingreso' && mov.grupoDestino === grupo) cantidad += mov.cantidad || 0;
        if (mov.tipo === 'Traspaso' && mov.grupoDestino === grupo && grupo !== 'Planta Lavada') cantidad += mov.cantidad || 0;
        if (mov.tipo === 'Traspaso' && mov.grupoOrigen === grupo) cantidad -= mov.cantidad || 0;
        if (mov.tipo === 'Ajuste' && mov.grupoDestino === grupo) cantidad += mov.cantidad || 0;
    }
    return Math.max(0, Math.round(cantidad * 100) / 100);
}

function agruparMovimientosPorProducto(movs) {
    const map = {};
    movs.forEach(m => {
        const key = `${m.color}|||${m.nombreVariedad}`;
        if (!map[key]) map[key] = [];
        map[key].push(m);
    });
    return map;
}

function calcularStockCompletoDeProducto(movs) {
    return {
        miristemos: calcularStockDesdeMovimientos(movs, 'Miristemos'),
        bioreactor: calcularStockDesdeMovimientos(movs, 'Bioreactor'),
        multiplicacion: calcularStockDesdeMovimientos(movs, 'Multiplicación'),
        raiz: calcularStockDesdeMovimientos(movs, 'Raíz'),
        planta: calcularStockDesdeMovimientos(movs, 'Planta Lavada'),
        invernadero: calcularStockDesdeMovimientos(movs, 'Invernadero')
    };
}

function calcularStockDeTodosLosProductos(productos, movimientos) {
    const movsPorProducto = agruparMovimientosPorProducto(movimientos);
    const resultado = {};
    productos.forEach(p => {
        const key = `${p.color}|||${p.nombre}`;
        const movs = movsPorProducto[key] || [];
        resultado[key] = calcularStockCompletoDeProducto(movs);
    });
    return resultado;
}

// ==================== ENDPOINTS BASE ====================

app.get('/api/colores', async (req, res) => {
    try {
        const colores = await Producto.distinct('color');
        res.json((colores.length > 0 ? colores : COLORES_FIJOS).sort());
    } catch (error) { res.json(COLORES_FIJOS); }
});

app.get('/api/variedades', async (req, res) => {
    try {
        const color = req.query.color;
        if (!color) return res.json([]);
        const productos = await Producto.find({ color });
        res.json(productos.map(p => p.nombre).sort());
    } catch (error) { res.status(500).json([]); }
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
    } catch (error) { res.status(500).json(`Error: ${error.message}`); }
});

app.get('/api/productos', async (req, res) => {
    try {
        const [productos, movimientos] = await Promise.all([Producto.find({}), Movimiento.find({})]);
        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        const resultado = productos.map(p => {
            const key = `${p.color}|||${p.nombre}`;
            const s = stocks[key] || { miristemos: 0, bioreactor: 0, multiplicacion: 0, raiz: 0, planta: { total: 0, grande: 0, mediana: 0, chica: 0, sinRaiz: 0 }, invernadero: 0 };
            return {
                _id: p._id, color: p.color, nombre: p.nombre, fechaProceso: p.fechaProceso, grupo: p.grupo,
                stockMiristemos: s.miristemos, stockBioreactor: s.bioreactor,
                stockMultiplicacion: s.multiplicacion,
                stockRaiz: s.raiz, stockPlanta: s.planta, stockInvernadero: s.invernadero
            };
        });
        res.json(resultado);
    } catch (error) { res.status(500).json([]); }
});

app.get('/api/buscar', async (req, res) => {
    try {
        const texto = req.query.q || '';
        if (texto.length < 1) return res.json([]);
        const busq = texto.toLowerCase().trim();
        const productos = await Producto.find({
            $or: [{ color: { $regex: busq, $options: 'i' } }, { nombre: { $regex: busq, $options: 'i' } }]
        });
        const movimientos = await Movimiento.find({});
        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        const resultado = productos.map(p => {
            const key = `${p.color}|||${p.nombre}`;
            const s = stocks[key] || { miristemos: 0, bioreactor: 0, multiplicacion: 0, raiz: 0, planta: { total: 0 }, invernadero: 0 };
            const total = s.miristemos + s.bioreactor + s.multiplicacion + s.raiz + (s.planta.total || 0) + s.invernadero;
            return {
                color: p.color, nombre: p.nombre, fechaProceso: p.fechaProceso, grupo: p.grupo,
                stockMiristemos: s.miristemos, stockBioreactor: s.bioreactor,
                stockMultiplicacion: s.multiplicacion, stockRaiz: s.raiz,
                stockPlanta: s.planta, stockInvernadero: s.invernadero, stockTotal: total
            };
        });
        res.json(resultado);
    } catch (error) { res.status(500).json([]); }
});

app.get('/api/stock', async (req, res) => {
    try {
        const [productos, movimientos] = await Promise.all([Producto.find({}), Movimiento.find({})]);
        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        const resultado = productos.map(p => {
            const key = `${p.color}|||${p.nombre}`;
            const s = stocks[key] || { miristemos: 0, bioreactor: 0, multiplicacion: 0, raiz: 0, planta: { total: 0 }, invernadero: 0 };
            const total = s.miristemos + s.bioreactor + s.multiplicacion + s.raiz + (s.planta.total || 0) + s.invernadero;
            return {
                color: p.color, nombre: p.nombre, cantidad: total,
                miristemos: s.miristemos, bioreactor: s.bioreactor,
                multiplicacion: s.multiplicacion, raiz: s.raiz,
                plantaTotal: s.planta.total || 0, invernadero: s.invernadero, stockMin: 0
            };
        });
        res.json(resultado);
    } catch (error) { res.status(500).json([]); }
});

// ==================== USUARIOS ====================
app.post('/api/usuarios', async (req, res) => {
    try {
        const { nombre, horasTrabajadas, area } = req.body;
        if (!nombre || !horasTrabajadas || !area) return res.status(400).json('Todos los campos son obligatorios.');
        const existe = await Usuario.findOne({ nombre });
        if (existe) return res.status(400).json('Este nombre de usuario ya está registrado.');
        const nuevo = new Usuario({ nombre, horasTrabajadas, area });
        await nuevo.save();
        res.json({ mensaje: 'Usuario registrado correctamente', usuario: nuevo });
    } catch (error) { res.status(500).json(`Error: ${error.message}`); }
});

app.get('/api/usuarios', async (req, res) => {
    try {
        res.json(await Usuario.find({ esSistema: { $ne: true } }).sort({ nombre: 1 }));
    } catch (error) { res.status(500).json([]); }
});

// ==================== BITÁCORA ====================
app.get('/api/bitacora/:usuarioId', async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const fechaStr = req.query.fecha || new Date().toISOString().split('T')[0];
        const fecha = getInicioDiaLocal(fechaStr);
        const [inicioDia, finDia] = getRangoDia(fecha);
        const bitacora = await BitacoraDiaria.findOne({
            usuarioId, fecha: { $gte: inicioDia, $lt: finDia }
        }).populate('usuarioId');
        res.json(bitacora || null);
    } catch (error) { res.status(500).json(null); }
});

app.patch('/api/bitacora/:usuarioId', async (req, res) => {
    try {
        const { usuarioId } = req.params;
        const { descripcion, produccion } = req.body;
        const fechaStr = req.query.fecha || new Date().toISOString().split('T')[0];
        const fecha = getInicioDiaLocal(fechaStr);
        const [inicioDia, finDia] = getRangoDia(fecha);

        if (descripcion === undefined && produccion === undefined) return res.status(400).json('Debe enviar datos.');

        let bitacora = await BitacoraDiaria.findOne({ usuarioId, fecha: { $gte: inicioDia, $lt: finDia } });
        if (!bitacora) {
            const usuario = await Usuario.findById(usuarioId);
            if (!usuario) return res.status(404).json('Usuario no encontrado.');
            bitacora = new BitacoraDiaria({
                usuarioId: usuario._id, fecha: inicioDia,
                horasTrabajadas: usuario.horasTrabajadas,
                descripcion: descripcion || '', produccion: produccion || 0, observaciones: ''
            });
        } else {
            if (descripcion !== undefined) bitacora.descripcion = descripcion;
            if (produccion !== undefined) bitacora.produccion = produccion;
        }
        await bitacora.save();
        res.json({ mensaje: 'Bitácora actualizada correctamente', bitacora });
    } catch (error) { res.status(500).json(`Error: ${error.message}`); }
});

app.get('/api/bitacoras', async (req, res) => {
    try {
        const fechaStr = req.query.fecha || new Date().toISOString().split('T')[0];
        const fecha = getInicioDiaLocal(fechaStr);
        const [inicioDia, finDia] = getRangoDia(fecha);
        const bitacoras = await BitacoraDiaria.find({
            fecha: { $gte: inicioDia, $lt: finDia }
        }).populate('usuarioId');
        res.json(bitacoras);
    } catch (error) { res.status(500).json([]); }
});

// ==================== RESUMEN ====================
app.get('/api/resumen', async (req, res) => {
    try {
        const [totalProductos, totalMovimientos] = await Promise.all([
            Producto.countDocuments(),
            Movimiento.countDocuments()
        ]);
        res.json({ totalProductos, totalMovimientos, sinStock: 0, stockBajo: 0, valorTotalInventario: 0, movimientosUltimoMes: 0 });
    } catch (error) { res.status(500).json({ totalProductos: 0, totalMovimientos: 0, sinStock: 0, stockBajo: 0 }); }
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
    } catch (error) { res.status(500).json({ errores: ['Error al validar'] }); }
});

// ==================== CONTINÚA EN PARTE 2 ====================
// ==================== MOVIMIENTOS ====================
app.post('/api/movimientos', async (req, res) => {
    try {
        const { color, nombre, fecha, tipo, grupoOrigen, grupoDestino,
            cantidadFrascos, subdivisiones, subdivisionOrigen, cantidad,
            usuarioId, observaciones } = req.body;

        if (!color || !nombre || !fecha || !tipo) return res.status(400).json('Faltan campos obligatorios.');
        const producto = await Producto.findOne({ color, nombre });
        if (!producto) return res.status(400).json('El producto no existe.');

        const fechaObj = getInicioDiaLocal(fecha);
        let nombreUsuario = 'Sistema';
        let usuario = null;
        if (usuarioId) {
            usuario = await Usuario.findById(usuarioId);
            if (usuario) nombreUsuario = usuario.nombre;
        }

        const movsProducto = await Movimiento.find({ color, nombreVariedad: nombre });

        // ============ INGRESO ============
        if (tipo === 'Ingreso') {
            if (!grupoDestino) return res.status(400).json('Falta grupo destino.');
            if (!GRUPOS_TODOS.includes(grupoDestino)) return res.status(400).json('Grupo destino inválido.');

            if (grupoDestino === 'Planta Lavada') {
                const sub = subdivisiones || {};
                const grande = parseInt(sub.grande) || 0;
                const mediana = parseInt(sub.mediana) || 0;
                const chica = parseInt(sub.chica) || 0;
                const sinRaiz = parseInt(sub.sinRaiz) || 0;
                const totalPlantas = grande + mediana + chica + sinRaiz;
                if (totalPlantas <= 0) return res.status(400).json('Debe distribuir al menos una planta.');

                const nuevoMov = new Movimiento({
                    color, nombreVariedad: nombre, fecha: fechaObj,
                    tipo: 'Ingreso', grupoDestino: 'Planta Lavada',
                    subdivisiones: { grande, mediana, chica, sinRaiz },
                    totalPlantas,
                    usuario: nombreUsuario, usuarioId: usuarioId || null,
                    esSistema: false, observaciones: observaciones || ''
                });
                await nuevoMov.save();
                return res.json(`Ingreso registrado: ${totalPlantas} plantas a Planta Lavada.`);
            }

            const cant = parseFloat(cantidad);
            if (isNaN(cant) || cant <= 0) return res.status(400).json('La cantidad debe ser mayor a 0.');

            const nuevoMov = new Movimiento({
                color, nombreVariedad: nombre, fecha: fechaObj,
                tipo: 'Ingreso', grupoDestino, cantidad: cant,
                usuario: nombreUsuario, usuarioId: usuarioId || null,
                esSistema: false, observaciones: observaciones || ''
            });
            await nuevoMov.save();
            return res.json('Ingreso registrado correctamente.');
        }

        // ============ TRASPASO ============
        if (tipo === 'Traspaso') {
            if (!grupoOrigen || !grupoDestino) return res.status(400).json('Falta grupo origen o destino.');
            if (!GRUPOS_TODOS.includes(grupoOrigen) || !GRUPOS_TODOS.includes(grupoDestino)) return res.status(400).json('Grupo inválido.');
            const permitidos = FLUJO_TRASPASOS[grupoOrigen] || [];
            if (!permitidos.includes(grupoDestino)) return res.status(400).json(`No se puede traspasar de "${grupoOrigen}" a "${grupoDestino}".`);

            // Raíz → Planta Lavada
            if (grupoOrigen === 'Raíz' && grupoDestino === 'Planta Lavada') {
                const frascos = parseFloat(cantidadFrascos);
                if (isNaN(frascos) || frascos <= 0) return res.status(400).json('Debe indicar la cantidad de frascos.');

                const stockRaiz = calcularStockDesdeMovimientos(movsProducto, 'Raíz');
                if (stockRaiz < frascos) return res.status(400).json(`Stock insuficiente en Raíz. Disponible: ${stockRaiz} frascos.`);

                const sub = subdivisiones || {};
                const grande = parseInt(sub.grande) || 0;
                const mediana = parseInt(sub.mediana) || 0;
                const chica = parseInt(sub.chica) || 0;
                const sinRaiz = parseInt(sub.sinRaiz) || 0;
                const totalPlantas = grande + mediana + chica + sinRaiz;
                if (totalPlantas <= 0) return res.status(400).json('Debe distribuir al menos una planta.');

                const nuevoMov = new Movimiento({
                    color, nombreVariedad: nombre, fecha: fechaObj,
                    tipo: 'Traspaso', grupoOrigen: 'Raíz', grupoDestino: 'Planta Lavada',
                    cantidadFrascos: frascos,
                    subdivisiones: { grande, mediana, chica, sinRaiz },
                    totalPlantas,
                    usuario: nombreUsuario, usuarioId: usuarioId || null,
                    esSistema: false, observaciones: observaciones || ''
                });
                await nuevoMov.save();
                return res.json(`Traspaso registrado: ${frascos} frascos → ${totalPlantas} plantas.`);
            }

            // Planta Lavada → Invernadero (MÚLTIPLES SUBDIVISIONES)
            if (grupoOrigen === 'Planta Lavada' && grupoDestino === 'Invernadero') {
                const sub = subdivisiones || {};
                const grande = parseInt(sub.grande) || 0;
                const mediana = parseInt(sub.mediana) || 0;
                const chica = parseInt(sub.chica) || 0;
                const sinRaiz = parseInt(sub.sinRaiz) || 0;
                const total = grande + mediana + chica + sinRaiz;

                if (total <= 0) return res.status(400).json('Debe indicar al menos una cantidad a traspasar.');

                const plantaStock = calcularStockDesdeMovimientos(movsProducto, 'Planta Lavada');

                if (grande > plantaStock.grande) return res.status(400).json(`Stock insuficiente en Grande. Disponible: ${plantaStock.grande}.`);
                if (mediana > plantaStock.mediana) return res.status(400).json(`Stock insuficiente en Mediana. Disponible: ${plantaStock.mediana}.`);
                if (chica > plantaStock.chica) return res.status(400).json(`Stock insuficiente en Chica. Disponible: ${plantaStock.chica}.`);
                if (sinRaiz > plantaStock.sinRaiz) return res.status(400).json(`Stock insuficiente en Sin Raíz. Disponible: ${plantaStock.sinRaiz}.`);

                const nuevoMov = new Movimiento({
                    color, nombreVariedad: nombre, fecha: fechaObj,
                    tipo: 'Traspaso', grupoOrigen: 'Planta Lavada', grupoDestino: 'Invernadero',
                    subdivisiones: { grande, mediana, chica, sinRaiz },
                    totalPlantas: total,
                    usuario: nombreUsuario, usuarioId: usuarioId || null,
                    esSistema: false, observaciones: observaciones || ''
                });
                await nuevoMov.save();
                return res.json(`Traspaso registrado: ${total} plantas a Invernadero.`);
            }

            // Traspaso normal (Miristemos → Bioreactor, Bioreactor → Multiplicación/Raíz, Multiplicación → Raíz)
            const cant = parseFloat(cantidad);
            if (isNaN(cant) || cant <= 0) return res.status(400).json('La cantidad debe ser mayor a 0.');

            const stockOrigen = calcularStockDesdeMovimientos(movsProducto, grupoOrigen);
            if (stockOrigen < cant) return res.status(400).json(`Stock insuficiente en ${grupoOrigen}. Disponible: ${stockOrigen}.`);

            const nuevoMov = new Movimiento({
                color, nombreVariedad: nombre, fecha: fechaObj,
                tipo: 'Traspaso', grupoOrigen, grupoDestino, cantidad: cant,
                usuario: nombreUsuario, usuarioId: usuarioId || null,
                esSistema: false, observaciones: observaciones || ''
            });
            await nuevoMov.save();
            return res.json('Traspaso registrado correctamente.');
        }

        return res.status(400).json('Tipo de movimiento no válido.');
    } catch (error) {
        console.error('Error en /api/movimientos:', error);
        res.status(500).json(`Error: ${error.message}`);
    }
});

// ==================== INVENTARIO VISTAS ====================
app.get('/api/inventario/general', async (req, res) => {
    try {
        const [productos, movimientos] = await Promise.all([Producto.find({}), Movimiento.find({})]);
        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        const totales = { 'Miristemos': 0, 'Bioreactor': 0, 'Multiplicación': 0, 'Raíz': 0, 'Planta Lavada': 0, 'Invernadero': 0 };
        Object.values(stocks).forEach(s => {
            totales['Miristemos'] += s.miristemos;
            totales['Bioreactor'] += s.bioreactor;
            totales['Multiplicación'] += s.multiplicacion;
            totales['Raíz'] += s.raiz;
            totales['Planta Lavada'] += s.planta.total || 0;
            totales['Invernadero'] += s.invernadero;
        });
        res.json(totales);
    } catch (error) { res.status(500).json({}); }
});

app.get('/api/inventario/grupo/:grupo', async (req, res) => {
    try {
        const grupo = req.params.grupo;
        if (!GRUPOS_TODOS.includes(grupo)) return res.status(400).json({ error: 'Grupo inválido.' });
        const [productos, movimientos] = await Promise.all([Producto.find({}), Movimiento.find({})]);
        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        const porColor = {};
        productos.forEach(p => {
            const key = `${p.color}|||${p.nombre}`;
            const s = stocks[key];
            if (!s) return;
            let cant = 0;
            if (grupo === 'Miristemos') cant = s.miristemos;
            else if (grupo === 'Bioreactor') cant = s.bioreactor;
            else if (grupo === 'Multiplicación') cant = s.multiplicacion;
            else if (grupo === 'Raíz') cant = s.raiz;
            else if (grupo === 'Planta Lavada') cant = s.planta.total || 0;
            else if (grupo === 'Invernadero') cant = s.invernadero;
            if (cant > 0) {
                if (!porColor[p.color]) porColor[p.color] = 0;
                porColor[p.color] += cant;
            }
        });
        res.json(porColor);
    } catch (error) { res.status(500).json({}); }
});

app.get('/api/inventario/color/:grupo/:color', async (req, res) => {
    try {
        const { grupo, color } = req.params;
        if (!GRUPOS_TODOS.includes(grupo)) return res.status(400).json({ error: 'Grupo inválido.' });
        const [productos, movimientos] = await Promise.all([
            Producto.find({ color }), Movimiento.find({})
        ]);
        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        const porVariedad = [];
        productos.forEach(p => {
            const key = `${p.color}|||${p.nombre}`;
            const s = stocks[key];
            if (!s) return;
            let cant = 0, sub = null;
            if (grupo === 'Miristemos') cant = s.miristemos;
            else if (grupo === 'Bioreactor') cant = s.bioreactor;
            else if (grupo === 'Multiplicación') cant = s.multiplicacion;
            else if (grupo === 'Raíz') cant = s.raiz;
            else if (grupo === 'Planta Lavada') { cant = s.planta.total || 0; sub = s.planta; }
            else if (grupo === 'Invernadero') cant = s.invernadero;
            if (cant > 0) porVariedad.push({ nombre: p.nombre, cantidad: cant, subdivisiones: sub });
        });
        res.json(porVariedad);
    } catch (error) { res.status(500).json([]); }
});

app.get('/api/inventario/variedad', async (req, res) => {
    try {
        const [productos, movimientos] = await Promise.all([Producto.find({}).sort({ color: 1, nombre: 1 }), Movimiento.find({})]);
        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        const resultado = productos.map(p => {
            const key = `${p.color}|||${p.nombre}`;
            const s = stocks[key] || { miristemos: 0, bioreactor: 0, multiplicacion: 0, raiz: 0, planta: { grande: 0, mediana: 0, chica: 0, sinRaiz: 0, total: 0 }, invernadero: 0 };
            const total = s.miristemos + s.bioreactor + s.multiplicacion + s.raiz + (s.planta.total || 0) + s.invernadero;
            return {
                color: p.color, nombre: p.nombre,
                miristemos: s.miristemos, bioreactor: s.bioreactor,
                multiplicacion: s.multiplicacion, raiz: s.raiz,
                plantaGrande: s.planta.grande || 0, plantaMediana: s.planta.mediana || 0,
                plantaChica: s.planta.chica || 0, plantaSinRaiz: s.planta.sinRaiz || 0,
                plantaTotal: s.planta.total || 0,
                invernadero: s.invernadero, total
            };
        });
        res.json(resultado);
    } catch (error) { res.status(500).json([]); }
});

// ==================== HISTORIAL ====================
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
            color: m.color, nombre: m.nombreVariedad,
            fecha: m.fecha.toLocaleDateString('es-ES'), tipo: m.tipo,
            grupoOrigen: m.grupoOrigen || '-', grupoDestino: m.grupoDestino || '-',
            cantidad: m.cantidad || m.cantidadFrascos || m.totalPlantas || 0,
            observaciones: m.observaciones || '',
            usuario: m.esSistema ? 'Sistema' : (m.usuario || 'N/A')
        })));
    } catch (error) { res.status(500).json([]); }
});

// ==================== EXPORTAR STOCK ====================
app.get('/api/exportar-stock', async (req, res) => {
    try {
        const [productos, movimientos] = await Promise.all([Producto.find({}), Movimiento.find({})]);
        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        let csv = '\uFEFFColor,Nombre,Miristemos,Bioreactor,Multiplicación,Raíz,Planta Grande,Planta Mediana,Planta Chica,Planta Sin Raíz,Planta Total,Invernadero,Total\n';
        productos.forEach(p => {
            const key = `${p.color}|||${p.nombre}`;
            const s = stocks[key] || { miristemos: 0, bioreactor: 0, multiplicacion: 0, raiz: 0, planta: { grande: 0, mediana: 0, chica: 0, sinRaiz: 0, total: 0 }, invernadero: 0 };
            const total = s.miristemos + s.bioreactor + s.multiplicacion + s.raiz + (s.planta.total || 0) + s.invernadero;
            csv += `"${p.color}","${p.nombre}",${s.miristemos},${s.bioreactor},${s.multiplicacion},${s.raiz},${s.planta.grande || 0},${s.planta.mediana || 0},${s.planta.chica || 0},${s.planta.sinRaiz || 0},${s.planta.total || 0},${s.invernadero},${total}\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=inventario_exportado.csv');
        res.send(csv);
    } catch (error) { res.status(500).send('Error al exportar'); }
});

// ==================== ADMIN: TODO EN UNO ====================
app.get('/api/admin/todo', async (req, res) => {
    try {
        const { password, limite } = req.query;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const [todasBitacoras, productos, movimientos] = await Promise.all([
            BitacoraDiaria.find({}).sort({ fecha: -1, timestamp: -1 }).populate('usuarioId').lean(),
            Producto.find({}).sort({ color: 1, nombre: 1 }).lean(),
            Movimiento.find({}).lean()
        ]);

        const todasLimpias = todasBitacoras.filter(b => b.usuarioId && !b.usuarioId.esSistema);
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
                _id: bit._id, fecha: bit.fecha,
                fechaStr: new Date(bit.fecha).toLocaleDateString('es-ES'),
                usuario: bit.usuarioId ? bit.usuarioId.nombre : 'Usuario desconocido',
                area: bit.usuarioId ? bit.usuarioId.area : '',
                horas: bit.horasTrabajadas || 0,
                produccion, nivel, nivelClass,
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
                total: totalDia, promedio: promDia, trabajadores: delDia.length
            });
        }

        const stocks = calcularStockDeTodosLosProductos(productos, movimientos);
        const listaProductos = productos.map(p => {
            const key = `${p.color}|||${p.nombre}`;
            const s = stocks[key] || { miristemos: 0, bioreactor: 0, multiplicacion: 0, raiz: 0, planta: { grande: 0, mediana: 0, chica: 0, sinRaiz: 0, total: 0 }, invernadero: 0 };
            const total = s.miristemos + s.bioreactor + s.multiplicacion + s.raiz + (s.planta.total || 0) + s.invernadero;
            return {
                _id: p._id, color: p.color, nombre: p.nombre, grupo: p.grupo, fechaProceso: p.fechaProceso,
                miristemos: s.miristemos, bioreactor: s.bioreactor,
                multiplicacion: s.multiplicacion, raiz: s.raiz,
                planta: s.planta, invernadero: s.invernadero, total
            };
        });

        res.json({
            bitacoras, totalBitacoras: todasLimpias.length,
            kpis: { totalProduccion, promedio, fechaMasReciente: fechaMasReciente ? new Date(fechaMasReciente).toLocaleDateString('es-ES') : null, kpisHoy },
            datosBarras, conteoNiveles, tendencia,
            productos: listaProductos
        });
    } catch (error) {
        console.error('Error en /api/admin/todo:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ADMIN: INVENTARIO INICIAL ====================
app.post('/api/admin/inventario-inicial', async (req, res) => {
    try {
        const { password, color, nombre, fechaProceso, grupo, cantidad, subdivisiones } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
        if (!color || !nombre || !fechaProceso || !grupo) return res.status(400).json({ error: 'Faltan campos.' });

        await asegurarUsuarioSistema();
        const usuarioSistema = await Usuario.findOne({ esSistema: true });

        let producto = await Producto.findOne({ color, nombre });
        if (!producto) {
            const fechaObjProd = getInicioDiaLocal(fechaProceso);
            producto = new Producto({ color, nombre, fechaProceso: fechaObjProd, grupo, stockMin: 0 });
            await producto.save();
        }

        const fechaObj = getInicioDiaLocal(fechaProceso);

        if (grupo === 'Planta Lavada') {
            const sub = subdivisiones || {};
            const grande = parseInt(sub.grande) || 0;
            const mediana = parseInt(sub.mediana) || 0;
            const chica = parseInt(sub.chica) || 0;
            const sinRaiz = parseInt(sub.sinRaiz) || 0;
            const total = grande + mediana + chica + sinRaiz;
            if (total <= 0) return res.status(400).json({ error: 'Debe distribuir al menos una planta.' });

            const nuevoMovimiento = new Movimiento({
                color, nombreVariedad: nombre, fecha: fechaObj,
                tipo: 'Ingreso', grupoDestino: 'Planta Lavada',
                subdivisiones: { grande, mediana, chica, sinRaiz },
                totalPlantas: total,
                usuario: USUARIO_SISTEMA, usuarioId: usuarioSistema._id,
                esSistema: true, observaciones: 'Inventario inicial - Planta Lavada'
            });
            await nuevoMovimiento.save();
            return res.json({ mensaje: `Inventario inicial: ${total} plantas de ${color}-${nombre} en Planta Lavada.` });
        }

        const cant = parseFloat(cantidad);
        if (isNaN(cant) || cant <= 0) return res.status(400).json({ error: 'Cantidad inválida.' });

        const nuevoMovimiento = new Movimiento({
            color, nombreVariedad: nombre, fecha: fechaObj,
            tipo: 'Ingreso', grupoDestino: grupo, cantidad: cant,
            usuario: USUARIO_SISTEMA, usuarioId: usuarioSistema._id,
            esSistema: true, observaciones: 'Inventario inicial'
        });
        await nuevoMovimiento.save();
        res.json({ mensaje: `Inventario inicial: ${cant} unidades de ${color}-${nombre} en ${grupo}.` });
    } catch (error) {
        console.error('Error inventario-inicial:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== ADMIN: EDITAR PRODUCTO ====================
app.post('/api/admin/editar-producto', async (req, res) => {
    try {
        const { password, productoId, nuevoColor, nuevoNombre } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
        if (!productoId) return res.status(400).json({ error: 'Producto no especificado.' });

        const producto = await Producto.findById(productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });

        const colorViejo = producto.color;
        const nombreViejo = producto.nombre;

        if (nuevoColor && !COLORES_FIJOS.includes(nuevoColor)) return res.status(400).json({ error: 'Color no permitido.' });

        const colorFinal = nuevoColor || producto.color;
        const nombreFinal = nuevoNombre && nuevoNombre.trim() ? nuevoNombre.trim() : producto.nombre;

        if (colorFinal !== colorViejo || nombreFinal !== nombreViejo) {
            const duplicado = await Producto.findOne({ color: colorFinal, nombre: nombreFinal, _id: { $ne: productoId } });
            if (duplicado) return res.status(400).json({ error: 'Ya existe otro producto con ese color y nombre.' });
        }

        producto.color = colorFinal;
        producto.nombre = nombreFinal;
        await producto.save();

        if (colorFinal !== colorViejo || nombreFinal !== nombreViejo) {
            await Movimiento.updateMany(
                { color: colorViejo, nombreVariedad: nombreViejo },
                { $set: { color: colorFinal, nombreVariedad: nombreFinal } }
            );
        }

        res.json({ mensaje: 'Producto actualizado correctamente.', producto });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== ADMIN: AJUSTAR STOCK ====================
app.post('/api/admin/ajustar-stock', async (req, res) => {
    try {
        const { password, productoId, grupo, cantidad, motivo } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
        if (!productoId) return res.status(400).json({ error: 'Producto no especificado.' });
        if (!grupo || !GRUPOS_TODOS.includes(grupo)) return res.status(400).json({ error: 'Grupo inválido.' });
        const cant = parseFloat(cantidad);
        if (isNaN(cant) || cant === 0) return res.status(400).json({ error: 'La cantidad debe ser diferente de 0.' });
        if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo es obligatorio.' });

        const producto = await Producto.findById(productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });

        await asegurarUsuarioSistema();
        const usuarioSistema = await Usuario.findOne({ esSistema: true });

        const nuevoMovimiento = new Movimiento({
            color: producto.color, nombreVariedad: producto.nombre,
            fecha: new Date(), tipo: 'Ajuste', grupoDestino: grupo, cantidad: cant,
            usuario: 'Admin (Ajuste)', usuarioId: usuarioSistema._id,
            esSistema: true, esAjuste: true, motivo: motivo.trim(),
            observaciones: `Ajuste manual: ${motivo.trim()} (${grupo})`
        });
        await nuevoMovimiento.save();
        res.json({ mensaje: `Ajuste aplicado en ${grupo}: ${cant > 0 ? '+' : ''}${cant}.` });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== ADMIN: ELIMINAR PRODUCTO ====================
app.post('/api/admin/eliminar-producto', async (req, res) => {
    try {
        const { password, productoId } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });
        if (!productoId) return res.status(400).json({ error: 'Producto no especificado.' });

        const producto = await Producto.findById(productoId);
        if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });

        const numMovs = await Movimiento.countDocuments({ color: producto.color, nombreVariedad: producto.nombre });
        if (numMovs > 0) return res.status(400).json({ error: `No se puede eliminar: tiene ${numMovs} movimiento(s).` });

        await Producto.findByIdAndDelete(productoId);
        res.json({ mensaje: 'Producto eliminado correctamente.' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== ADMIN: RESET TOTAL ====================
app.post('/api/admin/reset-total', async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Contraseña incorrecta' });

        const rProductos = await Producto.deleteMany({});
        const rMovimientos = await Movimiento.deleteMany({});
        const rBitacoras = await BitacoraDiaria.deleteMany({});
        const rUsuarios = await Usuario.deleteMany({ esSistema: { $ne: true } });

        res.json({
            mensaje: 'Sistema reseteado.',
            resultados: { productos: rProductos.deletedCount, movimientos: rMovimientos.deletedCount, usuarios: rUsuarios.deletedCount, bitacoras: rBitacoras.deletedCount }
        });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==================== ARRANQUE ====================
app.listen(PORT, '0.0.0.0', async () => {
    await asegurarUsuarioSistema();
    console.log(`✅ Servidor corriendo en el puerto ${PORT}`);
    console.log(`🔐 Admin password: ${ADMIN_PASSWORD === 'admin123' ? 'admin123 (por defecto)' : '(personalizado)'}`);
    console.log(`📋 Grupos: Miristemos, Bioreactor, Multiplicación, Raíz, Planta Lavada, Invernadero`);
    console.log(`🔄 Flujo: Miristemos → Bioreactor → (Multiplicación o Raíz) → Planta Lavada → Invernadero`);
});