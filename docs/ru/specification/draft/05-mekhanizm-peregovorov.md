# Глава 5. Механизм переговоров

## 5.1 Принципы переговоров

Реализация DTP **MUST** обеспечивать соблюдение следующих принципов переговоров:

1. **Переговоры в первую очередь**: до любой передачи данных Fragment **MUST** уже существовать Agreement в состоянии `active`.
2. **Никакой передачи без Agreement**: реализация **MUST NOT** допускать передачу данных, не опирающуюся на Agreement.
3. **Двусторонние переговоры**: Master **MAY** инициировать переговоры по сбору данных; Slave **MAY** инициировать переговоры по инжекции данных.
4. **Динамическая корректировка**: обе стороны **MAY** корректировать параметры Agreement, пока он находится в состоянии `active`.
5. **Явное прекращение**: обе стороны **MAY** явно прекратить Agreement. После прекращения передача данных в рамках этого Agreement **MUST** немедленно остановиться.

## 5.2 Типы переговорных фреймов

Переговоры **MUST** осуществляться через два типа фреймов: Request_Frame и Response_Frame.

### 5.2.1 Request_Frame

Request_Frame **MUST** содержать следующие поля:

```typescript
interface RequestFrame {
  frameType: "request";
  requestId: string;
  requestorRole: "master" | "slave";
  requestType: "collection" | "injection" | "adjustment" | "termination";
  targetAgreementId?: AgreementID;
  proposedParams: AgreementParams;
}
```

| Поле | Нормативное требование |
|------|------------------------|
| `frameType` | **MUST** быть литералом `"request"` |
| `requestId` | **MUST** быть уникальным идентификатором запроса. **SHOULD** использовать UUID v4 |
| `requestorRole` | **MUST** быть `"master"` или `"slave"`, идентифицирующим инициатора запроса |
| `requestType` | **MUST** быть одним из четырёх типов в таблице ниже |
| `targetAgreementId` | **MUST** быть указан, когда `requestType` — `"adjustment"` или `"termination"` |
| `proposedParams` | **MUST** содержать полные AgreementParams (см. раздел 5.4) |

### 5.2.2 RequestType

| Значение | Семантика | Ограничение |
|----------|-----------|-------------|
| `"collection"` | Запрос на сбор данных | **MUST** инициироваться `requestorRole = "master"` |
| `"injection"` | Запрос на инжекцию данных | **MUST** инициироваться `requestorRole = "slave"` |
| `"adjustment"` | Корректировка существующего Agreement | **MUST** содержать `targetAgreementId`; целевой Agreement **MUST** находиться в состоянии `active` |
| `"termination"` | Прекращение существующего Agreement | **MUST** содержать `targetAgreementId` |

Реализация **MUST** отклонять любой запрос, не удовлетворяющий приведённым выше ограничениям, и возвращать соответствующую ошибку (см. главу 9).

### 5.2.3 Response_Frame

Response_Frame **MUST** содержать следующие поля:

```typescript
interface ResponseFrame {
  frameType: "response";
  requestId: string;
  result: NegotiationResult;
  agreedParams?: AgreementParams;
  agreementId?: AgreementID;
  rejectionReason?: string;
}
```

| Поле | Нормативное требование |
|------|------------------------|
| `frameType` | **MUST** быть литералом `"response"` |
| `requestId` | **MUST** быть `requestId` соответствующего Request_Frame |
| `result` | **MUST** быть одним из значений `NegotiationResult` |
| `agreedParams` | **MUST** быть указан, когда `result` — `accepted` или `counter_proposal` |
| `agreementId` | **MUST** быть указан, когда `result` — `accepted`; **MUST** быть вновь сгенерированным UUID v4 |
| `rejectionReason` | **MUST** быть указана, когда `result` — `rejected` |

### 5.2.4 NegotiationResult

`NegotiationResult` **MUST** быть одним из следующих трёх значений:

| Значение | Семантика |
|----------|-----------|
| `"accepted"` | Принять запрос |
| `"rejected"` | Отклонить запрос |
| `"counter_proposal"` | Предложить альтернативу |

Реализация **MUST NOT** возвращать значения результата, не указанные в списке.

## 5.3 Процесс переговоров

### 5.3.1 Переговоры по сбору данных (инициируются Master)

Переговоры по сбору данных **MUST** следовать данному процессу:

1. Master отправляет Request_Frame с `requestType = "collection"` и `requestorRole = "master"`.
2. Slave **MUST** ответить Response_Frame с одним из следующих трёх результатов:
   - `"accepted"`: согласие передавать в соответствии с `proposedParams`. **MUST** включать вновь сгенерированный `agreementId` в Response_Frame.
   - `"rejected"`: отказ от передачи. **MUST** указать ограничение, связанное с соответствием требованиям (например, политика DLP), в `rejectionReason`. **MUST NOT** отказывать по причинам, не связанным с соответствием.
   - `"counter_proposal"`: предложение альтернативных параметров. **MUST** предоставить изменённые параметры в `agreedParams`.
3. Если Slave отвечает `counter_proposal`, Master **MAY** отправить новый Request_Frame, чтобы принять, отклонить или продолжить переговоры.
4. Master **MUST** сохранять результат ответа Slave для каждого запроса на сбор данных.

### 5.3.2 Переговоры по инжекции данных (инициируются Slave)

Переговоры по инжекции данных **MUST** следовать данному процессу:

1. Slave отправляет Request_Frame с `requestType = "injection"` и `requestorRole = "slave"`.
2. Master **MUST** ответить Response_Frame с одним из следующих трёх результатов:
   - `"accepted"`: согласие предоставить данные. **MUST** описать отфильтрованную область данных (минимизированный набор данных) в `agreedParams`. **MUST** включать вновь сгенерированный `agreementId` в Response_Frame.
   - `"rejected"`: отказ от предоставления данных. **SHOULD** указать причину в `rejectionReason`.
   - `"counter_proposal"`: предоставление данных другой области или формата. **MUST** описать альтернативу в `agreedParams`.
3. Master **MUST** обладать полным правом принятия решения по инжекции данных и **MUST NOT** принуждаться к принятию запроса.

### 5.3.3 Тайм-аут переговоров

Реализация **MUST** устанавливать пороговое значение тайм-аута для Request_Frame. Если Response_Frame от пира не получен в пределах порогового значения:

1. Инициатор **SHOULD** повторно отправить Request_Frame; число повторов **MUST NOT** превышать настроенный реализацией верхний предел.
2. После достижения верхнего предела повторов инициатор **MUST** прекратить переговоры и уведомить приложение верхнего уровня об ошибке `AGREEMENT_NEGOTIATION_FAILED` (3003).

## 5.4 AgreementParams

AgreementParams **MUST** содержать следующие поля:

```typescript
interface AgreementParams {
  dataType: string;
  dataRange: string;
  transferMode: TransferMode;
  frequency: number | null;
  validityPeriod: number;
  priority: Priority;
}
```

| Поле | Тип | Нормативное требование |
|------|-----|------------------------|
| `dataType` | `string` | **MUST** быть непустой. Идентифицирует тип данных |
| `dataRange` | `string` | **MUST** быть непустой. Описывает область данных |
| `transferMode` | `TransferMode` | **MUST** быть одним из трёх значений в таблице ниже |
| `frequency` | `number \| null` | В Гц. **MUST** быть null при `transferMode = "one_time"`; **MUST** быть положительным числом для других режимов |
| `validityPeriod` | `number` | В миллисекундах. **MUST** быть положительным целым числом |
| `priority` | `Priority` | **MUST** быть одним из четырёх значений в таблице ниже |

### 5.4.1 TransferMode

| Значение | Семантика |
|----------|-----------|
| `"one_time"` | Однократная передача. Agreement **SHOULD** автоматически прекращаться после завершения передачи |
| `"periodic"` | Периодическая передача. **MUST** задавать `frequency` |
| `"streaming"` | Потоковая передача. **MUST** задавать `frequency` |

### 5.4.2 Priority

| Значение | Семантика |
|----------|-----------|
| `"low"` | Низкий приоритет |
| `"normal"` | Нормальный приоритет (по умолчанию) |
| `"high"` | Высокий приоритет |
| `"critical"` | Критический приоритет |

Реализация **SHOULD** планировать конкуренцию ресурсов между несколькими Agreement в соответствии с `priority`.

## 5.5 Жизненный цикл Agreement

### 5.5.1 Определения состояний

`AgreementStatus` **MUST** быть одним из следующих четырёх значений:

| Состояние | Семантика |
|-----------|-----------|
| `"negotiating"` | Идут переговоры |
| `"active"` | Agreement действует; идёт передача данных |
| `"suspended"` | Соединение разорвано; Agreement приостановлен |
| `"terminated"` | Agreement прекращён |

### 5.5.2 Переходы состояний

Состояние Agreement **MUST** соответствовать следующим правилам переходов:

| Текущее состояние | Триггерное событие | Целевое состояние |
|-------------------|--------------------|-------------------|
| (нет) | Отправлен Request_Frame | `negotiating` |
| `negotiating` | Response_Frame возвращает `accepted` | `active` |
| `negotiating` | Response_Frame возвращает `rejected` | (прекращён) |
| `active` | Нижележащее соединение разорвано | `suspended` |
| `active` | Получен Request_Frame типа `termination` | `terminated` |
| `active` | Истёк `validityPeriod` | `terminated` |
| `suspended` | Соединение восстановлено и повторная верификация CAP пройдена | `active` |
| `suspended` | Тайм-аут хранения | `terminated` |
| `terminated` | (терминальное состояние) | (нет) |

### 5.5.3 Автоматическое прекращение однократных Agreement

Когда `transferMode = "one_time"` и передача данных завершена:

1. Отправитель **MUST** прекратить Agreement после последнего Fragment, отправив Request_Frame с `requestType = "termination"`.
2. Получатель **MUST** установить состояние Agreement в `terminated` после получения и подтверждения всех Fragment.

## 5.6 Одновременность нескольких Agreement

Реализация DTP **MUST** поддерживать одновременное существование нескольких Agreement в состоянии `active` в рамках одной Session.

Реализация **MUST** обеспечивать:

1. Каждый Fragment связан с конкретным Agreement через свой Agreement_ID.
2. Fragment, принадлежащие разным Agreement, **MAY** чередоваться в потоке передачи.
3. Конкретный способ передачи нескольких Agreement (последовательный или параллельный) **DEPENDS** от возможностей нижележащего Transport_Adapter.
4. Реализация **MUST NOT** ограничивать максимальное число активных Agreement в одной Session значением менее 16. **SHOULD** поддерживать произвольное число.

## 5.7 Ограничения переговоров для Observer

Роль Observer **MUST** удовлетворять следующим требованиям:

1. **MUST NOT** отправлять Request_Frame. Если Observer пытается отправить такой фрейм, DTP_Engine **MUST** отклонить операцию и вернуть ошибку `OBSERVER_WRITE_DENIED` (8002).
2. **MUST NOT** получать какие-либо права принятия решения по Response_Frame.
3. **MAY** получать копии data-фреймов только для чтения.
4. **MUST** быть явно авторизован Controller при подключении в качестве Observer.
