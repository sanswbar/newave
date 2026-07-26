# Newave — Bot de WhatsApp con IA

Bot que responde automáticamente por WhatsApp a los leads de Newave usando Claude,
con el conocimiento del negocio (planes, objeciones, tono de Santiago) y los empuja
a empezar la prueba gratis de 7 días en Skool.

## Arquitectura

```
Usuario escribe a WhatsApp
   ↓
Meta WhatsApp Cloud API
   ↓ (webhook POST)
Vercel Function (api/webhook.js)
   ↓
Claude (con system-prompt.md como cerebro)
   ↓
Respuesta → de vuelta por la API → al usuario
```

## Archivos

- `system-prompt.md` — el "cerebro": tono, planes, objeciones, guardrails. **Edita aquí** para cambiar cómo responde el bot.
- `api/webhook.js` — la función que recibe mensajes, llama a Claude y responde.
- `vercel.json` — config de despliegue.

## Variables de entorno (se configuran en Vercel, NO en el código)

| Variable | Qué es | De dónde sale |
|---|---|---|
| `VERIFY_TOKEN` | Palabra secreta que tú inventas para verificar el webhook | La inventas tú (ej. "newave2026") |
| `WHATSAPP_TOKEN` | Token de acceso de la Cloud API | Meta → WhatsApp → API Setup |
| `PHONE_NUMBER_ID` | ID del número de WhatsApp | Meta → WhatsApp → API Setup |
| `ANTHROPIC_API_KEY` | API key de Claude | console.anthropic.com |

## Pasos de despliegue (Fase 3)

1. Subir esta carpeta como proyecto en Vercel
2. Configurar las 4 variables de entorno
3. Copiar la URL del deploy (ej. `https://newave-bot.vercel.app/api/webhook`)
4. En Meta → WhatsApp → Configuration → pegar esa URL como Webhook + el VERIFY_TOKEN
5. Suscribir el webhook al evento `messages`
6. Probar mandando un WhatsApp al número

## Notas

- La memoria de conversación es en RAM (se pierde si el server reinicia). Suficiente
  para arrancar; si se quiere persistente, migrar a una DB (Vercel KV / Upstash).
- El bot solo responde texto. Audios/imágenes se ignoran por ahora.
