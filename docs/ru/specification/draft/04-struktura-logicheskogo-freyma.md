# Глава 4. Структура логического фрейма

## 4.1 Общая структура

LogicalFrame **MUST** состоять из двух частей:

```
+----------------+
|     Header     |   (plaintext)
+----------------+
|     Payload    |   (encrypted)
+----------------+
```

Формальное определение LogicalFrame:

```typescript
interface LogicalFrame {
  header: FrameHeader;
  payload: Uint8Array;  // encrypted
}
```

## 4.2 FrameHeader

Заголовок фрейма **MUST** содержать следующие поля. Порядок в таблице ниже является нормативным:

| Поле | Тип | Обязательное | Шифруется | Описание |
|------|-----|--------------|-----------|----------|
| `protocolVersion` | `ProtocolVersion` | **REQUIRED** | Нет | Версия протокола |
| `frameType` | `FrameType` | **REQUIRED** | Нет | Тип фрейма |
| `fragmentId` | `FragmentID` | **REQUIRED** | Нет | Уникальный идентификатор Fragment |
| `agreementId` | `AgreementID \| null` | **REQUIRED** | Нет | Идентификатор Agreement (**MAY** быть null) |
| `originTimestamp` | `OriginTimestamp` | **REQUIRED** | Нет | Временная метка источника (UTC мс) |
| `dagDependencies` | `DAGEdge[]` | **REQUIRED** | Нет | Список зависимостей DAG (**MAY** быть пустым массивом) |
| `encryptionMetadata` | `EncryptionMetadata` | **REQUIRED** | Нет | Метаданные шифрования |
| `sequenceNumber` | `SequenceNumber` | **REQUIRED** | Нет | Порядковый номер передачи |

Заголовок фрейма **MUST NOT** шифроваться. Все поля **MUST** передаваться в открытом виде.

## 4.3 FrameType

`FrameType` **MUST** быть одним из следующих четырёх значений перечисления:

| Значение | Назначение | Содержимое Payload |
|----------|------------|--------------------|
| `"data"` | Несёт фактические данные Fragment | Поле `data` Fragment |
| `"request"` | Инициирует запрос данных или корректирует Agreement передачи | Сериализованное содержимое RequestFrame |
| `"response"` | Отвечает на запрос данных | Сериализованное содержимое ResponseFrame |
| `"control"` | Передаёт управляющую информацию, такую как уведомления об ошибках и прекращение Agreement | Сериализованное содержимое ControlFrame |

Реализация **MUST NOT** вводить типы фреймов, не указанные в списке.

## 4.4 ProtocolVersion

`ProtocolVersion` **MUST** состоять из двух неотрицательных целых чисел:

```typescript
interface ProtocolVersion {
  major: number;
  minor: number;
}
```

Семантика номеров версий и правило классификации изменений **MUST** соответствовать правилам, определённым в главе 1 §1.7.2 (авторитетный источник).

## 4.5 Сжатие Agreement_ID

Поле `agreementId` **MAY** быть `null` в целях сжатия. Правила сжатия **MUST** соответствовать следующим требованиям:

1. В пакете последовательных Fragment, принадлежащих одному и тому же Agreement, **только** заголовок первого Fragment **MUST** содержать полный Agreement_ID.
2. Поле `agreementId` последующих Fragment **MAY** быть установлено в null, что означает повторное использование самого недавнего ненулевого Agreement_ID.
3. Получатель **MUST** поддерживать «текущий контекстный Agreement_ID» и интерпретировать его в соответствии со следующими правилами:
   - При получении Fragment с ненулевым `agreementId` его значение **MUST** обновляться как текущий контекстный Agreement_ID.
   - При получении Fragment с `agreementId`, равным null, он **MUST** связываться с текущим контекстным Agreement_ID.
4. Если получатель получает Fragment с `agreementId`, равным null, в то время как текущий контекстный Agreement_ID также равен null, он **MUST** отбросить Fragment и вернуть ошибку `AGREEMENT_NOT_FOUND` (3001).
5. Если получатель получает Fragment, ссылающийся на неизвестный Agreement_ID, он **MUST** отбросить Fragment и вернуть ошибку `AGREEMENT_NOT_FOUND` (3001).

Текущий контекстный Agreement_ID получателя **MUST** поддерживаться независимо для каждого направления передачи.

## 4.6 Origin_Timestamp

`originTimestamp` **MUST** удовлетворять следующим требованиям:

1. **MUST** использовать часовой пояс UTC.
2. **MUST** иметь точность до миллисекунд.
3. **MUST** быть неотрицательным целым числом (Unix-метка времени в миллисекундах).
4. **MUST** фиксировать момент, в который данные были фактически произведены источником, и **MUST NOT** фиксировать время передачи.
5. После прохождения полной цепочки передачи (сериализация → шифрование → передача → расшифровка → десериализация) **MUST** оставаться абсолютно идентичным значению до отправки.
6. Получатель **MUST NOT** изменять полученный Origin_Timestamp.

## 4.7 Зависимости DAG (DAGEdge)

`DAGEdge` **MUST** содержать следующие поля:

```typescript
interface DAGEdge {
  targetFragmentId: FragmentID;
  relationType: DAGRelationType;
}
```

`DAGRelationType` **MUST** быть одним из следующих трёх значений перечисления:

| Значение | Семантика |
|----------|-----------|
| `"derived_from"` | Данный Fragment получен из целевого Fragment |
| `"annotates"` | Данный Fragment аннотирует/поясняет целевой Fragment |
| `"supersedes"` | Данный Fragment заменяет целевой Fragment |

Массив `dagDependencies` **MAY** быть пустым (т.е. Fragment не имеет зависимостей).

## 4.8 EncryptionMetadata

`EncryptionMetadata` **MUST** содержать следующие поля:

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

| Поле | Нормативное требование |
|------|------------------------|
| `algorithm` | **MUST** быть строкой-идентификатором алгоритма шифрования (например, `"AES-256-GCM"`). **SHOULD** использовать имена алгоритмов, зарегистрированные в IANA |
| `keyVersion` | **MUST** быть неотрицательным целым числом. Используется для поддержки ротации ключей |

Сами метаданные шифрования **MUST NOT** шифроваться, и **MUST** включаться в открытом виде в заголовок фрейма.

## 4.9 Sequence_Number

`sequenceNumber` **MUST** удовлетворять следующим требованиям:

1. **MUST** быть неотрицательным целым числом.
2. **MUST** монотонно возрастать в рамках одной Session.
3. **MUST** поддерживаться независимо для каждого направления передачи (сбор данных, инжекция данных).
4. Пространство порядковых номеров **MUST NOT** разделяться между двумя направлениями.
5. **SHOULD** начинаться с 0 или 1.
6. Если порядковый номер переполняется (определяемое реализацией максимальное значение), реализация **MUST** обрабатывать это путём установления новой Session, и **MUST NOT** переходить через ноль.

## 4.10 Структура Fragment

Fragment **MUST** содержать следующие поля:

```typescript
interface Fragment {
  fragmentId: FragmentID;
  agreementId: AgreementID;
  originTimestamp: OriginTimestamp;
  contextMetadata: ContextMetadata;
  dagDependencies: DAGEdge[];
  data: Uint8Array;
}
```

Примечание: при сериализации поля `agreementId` Fragment в LogicalFrame оно может оказаться равным null в заголовке LogicalFrame из-за правил сжатия (см. раздел 4.5), однако логическое значение `agreementId` самого Fragment **MUST** всегда быть ненулевым.

## 4.11 ContextMetadata

`ContextMetadata` **MUST** содержать следующие поля:

```typescript
interface ContextMetadata {
  dataType: string;
  source: DataSource;
  customFields: Record<string, unknown>;
}
```

`DataSource` **MUST** быть одной из следующих двух структур (размеченное объединение, различаемое по полю `kind`):

### 4.11.1 HardwareSource

Когда данные поступают от аппаратного датчика, `source` **MUST** быть:

```typescript
interface HardwareSource {
  kind: "hardware";
  sensorType: string;
  precision: string;
  samplingRate: number;
}
```

| Поле | Нормативное требование |
|------|------------------------|
| `kind` | **MUST** быть строковым литералом `"hardware"` |
| `sensorType` | **MUST** быть непустой строкой. **SHOULD** использовать стандартизованные именования (например, `"accelerometer"`, `"heart_rate_monitor"`) |
| `precision` | **MUST** быть непустой строкой, описывающей точность датчика (например, `"±0.1°C"`) |
| `samplingRate` | **MUST** быть положительным числом, в Гц |

### 4.11.2 SoftwareSource

Когда данные поступают через программный обмен, `source` **MUST** быть:

```typescript
interface SoftwareSource {
  kind: "software";
  appIdentifier: string;
  sharingMethod: string;
}
```

| Поле | Нормативное требование |
|------|------------------------|
| `kind` | **MUST** быть строковым литералом `"software"` |
| `appIdentifier` | **MUST** быть непустой строкой. **SHOULD** использовать обратную доменную нотацию (например, `"com.example.app"`) |
| `sharingMethod` | **MUST** быть непустой строкой, описывающей способ обмена (например, `"api_push"`, `"clipboard_capture"`) |

### 4.11.3 Кастомные поля

`customFields` **MUST** быть отображением из строки в произвольное значение и **MAY** быть пустым объектом `{}`. Реализация **MUST NOT** дублировать в `customFields` информацию, уже присутствующую в `dataType` или `source`.

## 4.12 Требования к сериализации

Сериализация LogicalFrame **MUST** удовлетворять следующим нормативным требованиям:

1. **Детерминированность**: один и тот же объект LogicalFrame **MUST** давать один и тот же бинарный вывод.
2. **Согласованность при двойном проходе**: для любого корректного LogicalFrame последовательная сериализация и десериализация **MUST** давать LogicalFrame, эквивалентный исходному объекту.
3. **Полнота**: сериализованный вывод **MUST** содержать все поля заголовка фрейма.
4. **Шифрование Payload**: до сериализации Payload **MUST** уже быть зашифрован с использованием алгоритма, указанного в EncryptionMetadata.

Конкретный бинарный формат сериализации (порядок байтов, кодирование полей) будет определён в последующих черновиках; **SHOULD** отдаваться предпочтение зрелым бинарным форматам, таким как CBOR (RFC 8949) или Protocol Buffers.

## 4.13 Физическая фрагментация

Когда нижележащий транспорт требует фрагментации (например, из-за ограничений MTU в BLE):

1. Операция фрагментации **MUST** выполняться Transport_Adapter.
2. LogicalFrame **MUST** оставаться целым на уровне DTP_Engine.
3. Transport_Adapter получателя **MUST** собирать полный LogicalFrame перед его передачей в DTP_Engine.
