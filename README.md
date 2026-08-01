# Financial Tracker

Rastreador de finanzas personales de un solo usuario. Sustituye una hoja de cálculo que era la fuente
de verdad anterior; ahora lo es Supabase, y la hoja se importó una vez y ya no se sincroniza.

No es un producto multiusuario ni pretende serlo: hay una sola cuenta autorizada y todo el modelo está
construido alrededor de esa suposición.

## Stack

| Pieza | Qué hace |
|---|---|
| [Astro 7](https://astro.build) en `output: 'server'` | SSR obligatorio: la sesión vive en cookies, así que nada se prerenderiza salvo el login |
| [React 19](https://react.dev) como islas | Solo los componentes con interacción real se hidratan |
| [Supabase](https://supabase.com) (Postgres + Auth) | Única fuente de verdad, con RLS en todas las tablas |
| [Tailwind v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) | Primitivos vendorizados en `src/components/ui/` |
| [Recharts](https://recharts.org) | Gráficos, sobre el wrapper `ChartContainer` |
| [Zod](https://zod.dev) | Validación en el borde de cada API route |
| [Vercel](https://vercel.com) | Despliegue |

## Puesta en marcha

```bash
pnpm install
cp .env.example .env      # y llena los valores
pnpm dev                  # http://localhost:4321
```

`.env` necesita:

| Variable | Para qué |
|---|---|
| `PUBLIC_SUPABASE_URL` | URL del proyecto |
| `PUBLIC_SUPABASE_ANON_KEY` | Llave anónima; es segura en el navegador porque RLS protege cada fila |
| `ADMIN_EMAIL` | La única cuenta de Google que pasa el middleware |
| `PUBLIC_SITE_URL` | Base para construir el redirect de OAuth |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo para el script de import. Nunca llega al navegador |
| `SUPABASE_DB_PASSWORD` | Solo para aplicar migraciones desde la CLI |

Únicamente las variables `PUBLIC_*` pueden llegar al cliente.

### Autenticación

La app nunca habla con Google. `/api/auth/google` pide a Supabase la URL de autorización, Google le
responde a Supabase, y Supabase redirige a `/auth/callback` con un `code` que se canjea por una sesión.
Las credenciales de Google viven solo en el proyecto de Supabase.

Hay dos capas y las dos deben quedarse:

1. Los registros están deshabilitados en Supabase Auth.
2. El middleware rechaza cualquier correo distinto de `ADMIN_EMAIL`.

## Comandos

```bash
pnpm dev                 # servidor de desarrollo
pnpm build               # astro check && astro build; los errores de tipos rompen el build
pnpm check               # solo verificación de tipos
pnpm preview             # previsualiza el build de producción

pnpm db:push             # aplica supabase/migrations
pnpm db:reset            # recrea la base local y reejecuta migraciones + seed
pnpm db:types            # regenera src/lib/database.types.ts

pnpm import:sheet -- --dry-run   # analiza el CSV y reporta sin escribir
pnpm import:sheet                # import idempotente
```

> **No ejecutes `pnpm check` ni `pnpm build` con `pnpm dev` levantado.** Comparten
> `node_modules/.vite` y la reoptimización de dependencias corrompe el grafo de módulos del servidor
> vivo. El síntoma engaña: las páginas siguen respondiendo 200 porque el SSR no se ve afectado, pero
> ninguna isla hidrata y la interfaz se ve completa sin reaccionar a un solo clic. Reinicia después:
>
> ```bash
> npx astro dev stop && rm -rf node_modules/.vite && pnpm dev
> ```

La CLI de Supabase no está instalada globalmente: usa `npx supabase`. Aplicar migraciones no requiere
Personal Access Token si pasas la cadena de conexión directamente:

```bash
npx supabase db push --db-url "postgresql://postgres:<password-urlencoded>@db.<ref>.supabase.co:5432/postgres"
```

`supabase gen types` y `db reset` necesitan Docker, así que `src/lib/database.types.ts` se mantiene a
mano por ahora.

## Arquitectura

- **`src/middleware.ts`** corre en cada petición: construye el cliente de Supabase con
  `createServerClient`, llama a `auth.getUser()`, aplica el guardia de correo y publica
  `locals.supabase` y `locals.user`. Las únicas rutas públicas son `/login` y `/auth/*`.
- **Páginas** (`.astro`) consultan con `Astro.locals.supabase` durante el SSR y pasan datos planos a
  las islas. Nunca se crea un cliente de Supabase dentro de una página.
- **Islas** (`.tsx`) reciben todo por props. `client:load` solo para lo que está sobre el pliegue.
- **Escrituras** pasan por `src/pages/api/`, validadas con los esquemas de `src/lib/schemas.ts` y
  ejecutadas con la llave anónima, así que RLS sigue aplicando.
- **Agregaciones** viven en vistas `v_*` de Postgres, no en el navegador. Todas se declaran
  `security_invoker = true`; una vista sin eso corre como su dueño y se salta RLS en silencio.

## Decisiones del modelo de datos

Están respaldadas por check constraints. El código no debe rodearlas.

- **`amount_usd` es canónico y siempre positivo.** El signo lo da la columna `direction`
  (`income | expense | transfer`), nunca el monto.
- **Los traslados quedan fuera de toda suma de ingreso o gasto.** Meter dinero en una meta de ahorro es
  un traslado, no un gasto.
- **Las categorías son filas, no un enum**, así que agregar una no requiere migración. Las etiquetas de
  comportamiento como `gastos-hormiga` viven en un arreglo `tags`: un café puede ser *Comida* y una
  compra impulsiva a la vez.
- **Un presupuesto es una plantilla más excepciones.** `budget_templates` arrastra un monto desde
  `effective_from` en adelante y `budgets` es la excepción de un mes. Solo `budget_vs_actual(date)`
  sabe resolver cuál manda.
- **Un saldo derivado de transacciones no es un saldo.** La hoja original era un libro de partida
  simple: anotaba de qué cuenta salió el dinero, nunca los traslados entre cuentas propias.
- **Un saldo declarado se arrastra solo.** Una foto manual fija lo que hay en la cuenta un día, y a
  partir de ahí se le suma cada movimiento posterior. Los del mismo día se ubican comparando
  `created_at` contra la foto: comparar solo fechas congela la cifra hasta medianoche el día que la
  declaras, o cuenta dos veces lo que ya habías gastado antes de declararla.
- **El reparto por meta (`goal_allocations`) es manual y así se queda.** Registra dónde está hoy el
  dinero de una meta; las transacciones registran de dónde vino. Derivar lo uno de lo otro produce una
  respuesta segura y equivocada.

## Interfaz

La app es **solo clara**. Volver a agregar modo oscuro implica revalidar cada paleta de gráficos contra
la segunda superficie, no activar un interruptor.

Los colores de series están fijos en `--chart-1..6` y fueron validados **como conjunto** contra la
superficie clara: banda de luminosidad, piso de croma, separación bajo deuteranopía, separación en
visión normal y contraste 3:1. Se asignan en orden y nunca se ciclan; una novena serie se agrupa en
"Otros". No sustituyas uno sin volver a correr el validador.

Los formularios usan `SelectField` de `src/components/forms/Field.tsx`, nunca un `<select>` nativo: el
elemento nativo dibuja sus opciones a través del sistema operativo e ignora la paleta de la página. Las
confirmaciones destructivas usan `AlertDialog` por la misma razón.

El diseño es responsive sin excepción. Sobre `md` las secciones son píldoras en el encabezado; debajo,
una barra fija de pestañas al pie. La lista de transacciones es tabla desde `sm` y tarjetas por debajo:
una tabla de seis columnas que se desliza de lado cabe en un teléfono, pero no se lee.

## Convenciones

- Tipos explícitos en funciones exportadas; nada de `any`.
- Docstring en inglés en cada función, componente y módulo exportado. Sin comentarios en línea.
- Los montos son `numeric` en Postgres y llegan como **strings** a JS. Convertir con `Number()` en el
  borde y formatear con `src/lib/format.ts`; nunca hacer aritmética sobre el string.
- Las fechas son strings `YYYY-MM-DD` de punta a punta. No se pasan objetos `Date` entre SSR e islas.
- El alias `@/*` apunta a `src/*`.

## Datos

`data/` está en `.gitignore` y contiene el export crudo de la hoja de cálculo con finanzas reales.
No se commitea y su contenido no se pega en código ni en pruebas.

`schema-example.json` documenta la forma **vieja** de la hoja y se conserva solo como referencia para
el script de import. No es el modelo de datos actual.
