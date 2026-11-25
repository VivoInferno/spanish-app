#!/usr/bin/env python3
"""v9.7 (one-off, already applied): more story lines so each unit's new words come back in its story (2+ times each)."""
import json, collections
P = 'content.json'
ADD = {  # uid: (insert index or None = append, [(speaker, es, en)]), plus optional line edits {index: (es, en)}
 'u1': (8, [('Laura', 'Aquí está la carta del señor Gómez y el comprobante de domicilio.', "Here's Mr. Gómez's letter and the proof of address."),
            ('Ejecutiva', 'Gracias. Me entrega también el recibo de luz, por favor.', 'Thank you. Please hand me the electricity bill too.'),
            ('Laura', 'Sí, aquí está. ¿Necesito hacer otra cita?', 'Yes, here it is. Do I need to make another appointment?')]),
 'u2': (None, [('Andrés', 'Perfecto. El refri lleva dos días descompuesto y ya no enfría.', "Perfect. The fridge has been broken for two days and it doesn't get cold anymore."),
               ('Plomero', 'No se preocupe. Mi primo se lo arregla rápido.', "Don't worry. My cousin will fix it for you quickly.")]),
 'u3': (6, [('Mariana', 'Entonces mando el presupuesto con la propuesta para que lo aprueben juntos.', "Then I'll send the budget with the proposal so they approve it all together."),
            ('Jefe', 'Sí, y no se te olvide el plazo: el jueves a primera hora.', "Yes, and don't forget the deadline: Thursday first thing.")]),
 'u4': (None, [('Itzel', 'Va. Y las casetas las pagamos entre los dos.', "Okay. And we'll split the tolls."),
               ('Rodrigo', 'Trato hecho. ¿Cuánto cuesta cada caseta?', 'Deal. How much is each toll?'),
               ('Itzel', 'Unos cien pesos. Y la próxima vez, compra un boleto sin escala.', 'About a hundred pesos. And next time, buy a ticket without a layover.')]),
 'u5': (None, [('Elena', 'Gracias, doctor. ¿Me tomo la pastilla antes o después de comer?', 'Thank you, doctor. Do I take the pill before or after eating?'),
               ('Doctor', 'Después de desayunar. Y si quiere, la enfermera del consultorio le explica todo.', "After breakfast. And if you'd like, the nurse at the office will explain everything.")]),
 'u6': (11, [('Marco', 'Hasta el sábado, doña Lupe. Su puesto es el mejor del mercado.', "See you Saturday, doña Lupe. Your stall is the best one in the market."),
             ('Doña Lupe', 'Gracias, joven. El sábado le aparto unos bien maduros y se los peso antes, para que no regatee tanto.', "Thanks, young man. On Saturday I'll set aside some really ripe ones and weigh them ahead of time, so you don't haggle so much.")],
        {0: ('Es sábado y Marco va al puesto de doña Lupe en el mercado.', "It's Saturday and Marco goes to doña Lupe's stall at the market.")}),
 'u7': (10, [('Sofía', '¿Y la transferencia llega el mismo día?', 'And does the transfer arrive the same day?'),
             ('Ejecutivo', 'Sí, en unos minutos. Y para no pagar comisión, use nuestros cajeros.', 'Yes, in a few minutes. And to avoid fees, use our ATMs.'),
             ('Sofía', 'Perfecto. Voy a revisar mi estado de cuenta cada semana.', "Perfect. I'm going to check my bank statement every week.")]),
 'u8': (9, [('Sra. Pérez', 'Gracias, Carlos. No me quería quejar, pero con tanto ruido no dormía.', "Thank you, Carlos. I didn't want to complain, but with so much noise I couldn't sleep.")]),
 'u9': (None, [('Mecánico', 'Con gusto. Y la llanta ponchada ya tiene parche; se la dejo en la cajuela.', "Sure. And the flat tire is patched now; I'll leave it in the trunk for you."),
               ('Paola', 'Qué buen taller. La próxima vez venimos aquí a cambiar el aceite.', "What a good shop. Next time we'll come here to change the oil.")]),
 'ta1': (None, [('Mariana', 'Con gusto, señor Ortega. Lo espero el sábado.', "My pleasure, Mr. Ortega. I'll see you on Saturday."),
                (None, 'Mariana sonríe: el prospecto nuevo está muy interesado en Tres Aguas.', 'Mariana smiles: the new prospect is very interested in Tres Aguas.')]),
 'ta2': (11, [('Javier', '¿Nos puede mandar también el plan maestro y la lotificación?', 'Can you also send us the master plan and the lot layout?'),
              ('Mariana', 'Claro. Así ven qué lotes quedan en esta etapa y cómo va a quedar el fraccionamiento.', "Of course. That way you'll see which lots are left in this phase and how the development will look.")]),
 'ta3': (None, [('Sr. Ortega', 'Gracias, Mariana. No sabía que quedaba tan cerca de la carretera costera.', "Thanks, Mariana. I didn't know it was so close to the coastal highway."),
                ('Mariana', 'Sí, desde el entronque son unos minutos. Y la playa queda cerca, a pie.', "Yes, from the junction it's just a few minutes. And the beach is close, on foot.")]),
 'ta4': (None, [('Sofía', 'Gracias. Le mando la clave del lote en el mensaje del pago.', "Thanks. I'll put the lot code in the payment message."),
                ('Mariana', 'Perfecto. Con la clave del lote lo encuentro rápido en el sistema.', 'Perfect. With the lot code I can find it quickly in the system.')]),
 'u10': (None, [('Doña Chela', '¿Ves? La sobremesa es lo mejor de la comida.', 'See? The sobremesa is the best part of the meal.'),
                ('Don Rafa', 'Aquí solemos quedarnos hasta que oscurece.', 'Here we usually stay until it gets dark.'),
                ('Mark', 'Gracias por todo. Son unos anfitriones increíbles.', "Thank you for everything. You're amazing hosts.")]),
 'ta5': (None, [('Sofía', 'Gracias. Con la superficie y el frente ya puedo hablar con el arquitecto.', 'Thanks. With the area and the frontage I can now talk to the architect.'),
                ('Mariana', 'Exacto. Y con veinte metros de frente hay espacio para una casa con jardín.', 'Exactly. And with twenty meters of frontage there is room for a house with a garden.')]),
}
raw = open(P, encoding='utf-8').read(); c = json.loads(raw, object_pairs_hook=collections.OrderedDict)
for u in c['units']:
    if u['id'] not in ADD: continue
    spec = ADD[u['id']]; at, lines = spec[0], spec[1]; edits = spec[2] if len(spec) > 2 else {}
    st = u['story']; L = st['lines']
    if any(l['es'] == lines[0][1] for l in L): continue  # already applied
    for i, (es, en) in edits.items(): L[i]['es'] = es; L[i]['en'] = en; L[i].pop('alts', None)
    new = [collections.OrderedDict([('s', s), ('es', es), ('en', en)]) for s, es, en in lines]
    if at is None: L.extend(new)
    else:
        L[at:at] = new
        for q in st['qs']:
            if q['after'] >= at: q['after'] += len(new)
open(P, 'w', encoding='utf-8').write(json.dumps(c, ensure_ascii=False, indent=1) + ('\n' if raw.endswith('\n') else ''))
print('ok')
