# Глава 3. Архитектура протокола

## 3.1 Уровни протокола

Реализация DTP **MUST** быть организована в соответствии со следующей послойной структурой:

```
+-----------------------------------------------+
|             Application Layer                  |
|   iFay / coFay / Personal Data Heap            |
|   Terminal Applications                        |
+-----------------------------------------------+
|             DTP Protocol Layer                 |
|   DTP_Engine (DTP_Master / DTP_Slave)          |
|   - Agreement Manager                          |
|   - Frame Codec                                |
|   - DAG Manager                                |
|   - Encryption Module                          |
|   - Session Manager                            |
|   - Resume Manager                             |
+-----------------------------------------------+
|             Adapter Layer                      |
|   Transport_Adapter                            |
+-----------------------------------------------+
|             Transport Layer                    |
|   BLE / WebSocket / TCP / RTSP / ...           |
+-----------------------------------------------+
```

Реализация **MUST NOT** выполнять межуровневые вызовы (например, прикладной уровень **MUST NOT** напрямую обращаться к интерфейсу слоя адаптеров).

## 3.2 Основные компоненты

DTP_Engine **MUST** включать в себя следующие шесть основных компонентов:

### 3.2.1 Agreement Manager

Agreement Manager **MUST** обеспечивать следующие возможности:

1. **Управление потоком переговоров**: обработка отправки и приёма Request_Frame и Response_Frame.
2. **Управление жизненным циклом Agreement**: поддержка переходов состояний Agreement от `negotiating` до `terminated`.
3. **Генерация уникальных идентификаторов**: генерация UUID v4, соответствующего RFC 4122, в качестве Agreement_ID для каждого установленного Agreement.
4. **Поддержка одновременности нескольких Agreement**: **MUST** поддерживать одновременное существование нескольких активных Agreement в рамках одной Session.

### 3.2.2 Frame Codec

Frame Codec **MUST** обеспечивать следующие возможности:

1. **Сериализация**: кодирование объекта LogicalFrame в бинарную последовательность байтов.
2. **Десериализация**: декодирование бинарной последовательности байтов в объект LogicalFrame.
3. **Согласованность при двойном проходе**: для любого корректного объекта LogicalFrame сериализация с последующей десериализацией **MUST** давать LogicalFrame, эквивалентный исходному объекту.
4. **Pretty Printer**: **SHOULD** предоставлять возможность преобразования LogicalFrame в человекочитаемый текст и **SHOULD** включать все ключевые поля заголовка фрейма.

### 3.2.3 DAG Manager

DAG Manager **MUST** обеспечивать следующие возможности:

1. **Обнаружение циклов**: перед добавлением Fragment в DAG **MUST** проверить, что цикл не образуется. При обнаружении цикла Fragment **MUST** быть отклонён, и **MUST** быть возвращена ошибка `DAG_CYCLE_DETECTED` (4001).
2. **Разрешение зависимостей**: если объявленная Fragment целевая зависимость ещё не получена, Fragment **MUST** быть помечен как «ожидающий разрешения зависимостей» и закэширован.
3. **Отложенное разрешение**: при поступлении Fragment, от которого имеется зависимость, ранее закэшированные Fragment **MUST** быть автоматически разрешены.
4. **Поддержка типов отношений**: **MUST** поддерживать три типа отношений: `derived_from`, `annotates` и `supersedes`.

### 3.2.4 Encryption Module

Encryption Module **MUST** обеспечивать следующие возможности:

1. **Шифрование Payload**: шифрование Payload с использованием ключа, заранее согласованного через CAP.
2. **Расшифровка Payload**: расшифровка полученного Payload с использованием ключа, заранее согласованного через CAP.
3. **Проверка готовности ключа**: перед любой операцией шифрования **MUST** проверить, что CAP завершил обмен ключами.
4. **Генерация метаданных шифрования**: **MUST** включать метаданные шифрования (идентификатор алгоритма и версию ключа) в открытом виде в заголовке фрейма.

### 3.2.5 Session Manager

Session Manager **MUST** обеспечивать следующие возможности:

1. **Управление жизненным циклом Session**: установление, поддержание и закрытие Session.
2. **Сохранение состояния**: при разрыве нижележащего соединения **MUST** сохранять состояние Session.
3. **Восстановление состояния**: после восстановления соединения и успешной повторной верификации CAP **MUST** иметь возможность восстановить предыдущее состояние Session.
4. **Обнаружение тайм-аутов**: **MUST** реализовывать обнаружение простоя Session по тайм-ауту.

### 3.2.6 Resume Manager

Resume Manager **MUST** обеспечивать следующие возможности:

1. **Назначение порядковых номеров**: присвоение каждому отправляемому Fragment монотонно возрастающего порядкового номера.
2. **Кэш неподтверждённых Fragment**: локальное кэширование Fragment до момента их подтверждения получателем.
3. **Сообщение о точке прерывания**: при восстановлении соединения отправка пиру наибольшего успешно полученного порядкового номера.
4. **Управление кэшем**: **MUST** реализовывать проверку верхнего предела ёмкости кэша. При достижении предела отправка **MUST** быть приостановлена, и **MUST** быть возвращена ошибка `BUFFER_FULL` (6001).

## 3.3 Конечный автомат

DTP_Engine **MUST** реализовывать следующий конечный автомат:

```
                 [Idle]
                    |
                    | Connection request received
                    v
             [WaitingForCAP]
                    |
                    | CAP authentication + key exchange complete
                    v
             [SessionEstablished]
                    |
                    | Send or receive Request_Frame
                    v
              [Negotiating]
                    |
                    | Agreement reached
                    v
              [Transmitting]
                    |
                    | Connection interrupted
                    v
                [Suspended]
                    |
                    | Connection restored + CAP re-verified
                    v
                [Resuming]
                    |
                    | Resume handshake complete
                    v
              [Transmitting]
```

Полные правила переходов состояний **MUST** соответствовать следующей таблице:

| Текущее состояние | Триггерное событие | Целевое состояние | Примечания |
|-------------------|--------------------|-------------------|------------|
| `Idle` | Получен запрос на подключение | `WaitingForCAP` | |
| `WaitingForCAP` | CAP аутентификация и обмен ключами завершены | `SessionEstablished` | |
| `WaitingForCAP` | Сбой или тайм-аут CAP | `Idle` | **MUST** освободить связанные ресурсы |
| `SessionEstablished` | Отправлен или получен Request_Frame | `Negotiating` | |
| `SessionEstablished` | Тайм-аут Session | `Idle` | **MUST** закрыть Session |
| `Negotiating` | Agreement достигнут | `Transmitting` | |
| `Negotiating` | Переговоры провалились или отклонены | `SessionEstablished` | |
| `Transmitting` | Продолжение передачи Fragment | `Transmitting` | Самопереход |
| `Transmitting` | Получен Request_Frame типа adjustment | `Negotiating` | |
| `Transmitting` | Нижележащее соединение разорвано | `Suspended` | **MUST** сохранить состояние Session |
| `Transmitting` | Agreement прекращён, других активных Agreement нет | `SessionEstablished` | |
| `Suspended` | Соединение восстановлено и повторная верификация CAP пройдена | `Resuming` | |
| `Suspended` | Тайм-аут Session | `Idle` | **MUST** освободить ресурсы |
| `Resuming` | Резюм-рукопожатие завершено | `Transmitting` | |
| `Resuming` | Восстановление провалилось | `Idle` | **MUST** закрыть Session |

Реализация **MUST NOT** вводить переходы состояний, не указанные в таблице выше.

## 3.4 Интерфейс Transport_Adapter

Transport_Adapter **MUST** предоставлять следующий интерфейс:

```typescript
interface Transport_Adapter {
  // Connection management
  connect(endpoint: TransportEndpoint): Connection;
  disconnect(connectionId: ConnectionID): void;

  // Data transmission
  send(connectionId: ConnectionID, data: Uint8Array): void;
  onReceive(handler: (connectionId: ConnectionID, data: Uint8Array) => void): void;

  // State events
  onConnectionStateChange(handler: (connectionId: ConnectionID, state: ConnectionState) => void): void;
}
```

Конкретная реализация Transport_Adapter **MUST** удовлетворять следующим нормативным требованиям:

1. Операция `send()` **MUST** быть неблокирующей.
2. При изменении состояния нижележащего соединения DTP_Engine **MUST** уведомляться через колбэк `onConnectionStateChange`.
3. **MUST** предоставлять единую реализацию интерфейса для каждого поддерживаемого транспортного протокола (BLE, WebSocket, TCP, RTSP).
4. **MUST NOT** изменять бинарные данные, переданные DTP_Engine.

## 3.5 Последовательность взаимодействия Master-Slave

Полное взаимодействие DTP **MUST** соответствовать следующим пяти фазам:

### Фаза 1: предварительная обработка CAP

DTP_Engine **MUST** ожидать завершения CAP аутентификации и обмена ключами. В течение этой фазы DTP **MUST NOT** отправлять никакие data-фреймы.

### Фаза 2: установление DTP-сессии

После завершения CAP DTP_Engine **MUST** сгенерировать уникальный Session_ID (UUID v4) и перейти в состояние `SessionEstablished`.

### Фаза 3: переговоры

Фаза 3a (переговоры по сбору данных): Master **MAY** отправить Request_Frame с `requestType = collection`, и Slave **MUST** ответить Response_Frame со значением `accepted`, `rejected` или `counter_proposal`.

Фаза 3b (переговоры по инжекции данных): Slave **MAY** отправить Request_Frame с `requestType = injection`, и Master **MUST** ответить Response_Frame.

### Фаза 4: передача данных

После достижения Agreement отправитель **MUST** передавать Fragment через data-фреймы, и каждый Fragment **MUST** содержать соответствующий ему Agreement_ID (или опускать его для наследования контекста, см. раздел 4.5).

### Фаза 5: разрыв соединения и восстановление

При разрыве нижележащего соединения DTP_Engine **MUST** перейти в состояние `Suspended` и сохранить Session. После восстановления соединения **MUST** выполняться повторная верификация CAP, после чего движок **MUST** перейти в состояние `Resuming` для завершения резюм-рукопожатия.
