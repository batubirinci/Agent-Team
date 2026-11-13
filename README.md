# agent-team

Claude Code için bir takım eklentisi: ana sohbet **Lead** olur, işi Analyst, Developer ve QA
rollerine dağıtır; sahibe yalnızca karar gerekince döner. Eklenti dört parçadan oluşur:

- **`agent-team` skill'i** (`skills/agent-team/SKILL.md`): Lead'in akışı. Spec, build, review,
  revise, rapor; her devir Lead üzerinden geçer, roller birbirine doğrudan iş vermez.
- **6 rol ajanı** (`agents/`): `team-analyst`, `team-analyst-high`, `team-developer-sonnet`,
  `team-developer`, `team-qa2`, `team-helper`. Model ve çaba her ajan dosyasının başlığındadır.
  Skill'e göre Analyst 2 ve QA rolleri ajan dosyası değil, Codex CLI (GPT-6 Astra) ile çalışır
  (`skills/agent-team/references/gpt-roles.md`).
- **Push / PR koruması** (`hooks/guard-push.sh`): Bash çağrılarında `git push`, `gh pr
  create|merge|ready` ve yazma yapan `gh api` çağrıları için sahibin onayını ister. Komutu kabuk
  kurallarıyla ayrıştırır (sarmalayıcılar, `bash -c`, heredoc). Ayrıştıramazsa yalnızca metinde
  `push`, `pr` ya da `api` geçiyorsa sorar; geçmiyorsa komutu karışmaz.
- **Masaüstü pane'i** (`hooks/register.tsx`): kararları, görevleri, rol durumlarını ve kullanım
  yüzdelerini gösterir.

## Kurulum

Eklenti yerel bir marketplace olarak kurulur; klasörün kendisi okunur.

```sh
claude plugin marketplace add <repo klasörü>
claude plugin install agent-team@agent-team-local
```

Klasördeki bir değişiklik `/reload-plugins` ile alınır.

## Kullanım

**Takım modunu açmak.** Mod açıkken oturumdaki her mesaj Lead'e gider; `/agent-team` yazmak
gerekmez (slash komutları hariç). Üç yolu var:

- `teamFolders` seçeneğindeki bir klasörde (ya da altında) açılan oturum kendiliğinden takım olur.
- Alt satırdaki **Agent Team** hapına basmak (açıkken `● Agent Team`, kapalıyken `○ Agent Team`).
  Aynı satırdaki **Pane** düğmesi pane'i yeniden açar.
- `/team` yazmak; aç/kapa anahtarıdır.

Mod açılınca pane da açılır. `/team-pane` de pane'i açar.

**Terminalde kısayollar.** Pane odaktayken: `1`-`9` karar seçenekleri, `a c d e f g h i j k m n o` görev
ayrıntıları (sırayla), `p` pause/devam, ayrıntıda `b` geri ve `s` Lead'e sor, alt satırda `t` pane'i açar;
`esc` odağı sohbete döndürür. Alt satır `◉ agent team` (açık) ya da `○ agent team` (kapalı) der.

**Pane ne gösterir.** Lead'in yazdığı durum dosyasını canlı gösterir:

- **Senin sıran:** bekleyen kararlar. Bir seçeneğe basmak mesaj kutusuna
  `Karar (<id>): <seçenek>` satırını yazar; göndermek için Enter'a basarsın (birkaç karar tek Enter'la gider).
- **Diğer oturumlar:** aynı makinedeki başka team oturumlarında bekleyen kararlar yalnızca okunur bir
  şeritte görünür (`Göster`/`Gizle`, terminalde `v`); cevap o oturumda verilir.
- **Görevler:** her görev için 5 aşamalı çizgi (Spec, Build, Review, Revise, Rapor) ve rollerin
  durumu.
- **Ayrıntı:** görev kartındaki **Ayrıntı ›** turları, bulguları, Lead notunu ve kanıt yollarını açar.
- **Kullanım çubukları:** 5 saatlik ve haftalık kullanım yüzdeleri.
- **Pause:** Lead'e `Pause` mesajı gönderir; duraklatılmışken düğme **Devam** olur.

Hangi alanın neyi çizdiği [`skills/agent-team/references/status.md`](skills/agent-team/references/status.md)
içinde.

Durum dosyası yokken pane boş ekranı gösterir. Takım modu açıksa bu "Takım hazır" ekranıdır:
örnek istemler, akış adımları ve rol listesi. Mod kapalıysa "Agent Team kapalı" yazar ve "Bu
sohbette aç" düğmesi çıkar.

## Seçenekler

`.claude-plugin/plugin.json` içindeki `userConfig`:

| Seçenek | Anlamı | Varsayılan |
|---|---|---|
| `teamFolders` | Bu klasörlerde (ve altlarında) açılan oturumlar kendiliğinden Agent Team olur. Virgülle ayrılır, `~` kullanılabilir. | boş |
| `evidenceRoot` | Lead'in raporlarını ve durum dosyasını yazdığı klasör. | `~/agent-team-evidence` |

Etkileşimsiz ayarlamak için JSON nesnesini stdin'den ver (değerler tek satırlık metin olmalı,
verilmeyen seçenekler eski değerini korur):

```sh
echo '{"teamFolders": "~/Projeler", "evidenceRoot": "~/agent-team-evidence"}' \
  | claude plugin configure agent-team@agent-team-local --values-stdin
```

`claude plugin configure agent-team@agent-team-local` seçenekleri ve hangilerinin boş olduğunu
gösterir.

## Durum dosyası

Lead, pane'in okuduğu durumu `<evidenceRoot>/status/<proje>--<oturum kimliğinin ilk 8 karakteri>.json` dosyasına (yolu plugin verir) yazar; böylece aynı klasördeki oturumlar birbirinin durumunu ezmez. Eski `<proje>.json` dosyaları artık okunmaz. Pane dosyayı 3
saniyede bir kontrol eder. Biçim: [`skills/agent-team/references/status.md`](skills/agent-team/references/status.md).

## Geliştirme

```sh
claude plugin validate .
claude plugin test .
```

`claude plugin test .` `tests/agent-team.test.tsx` içindeki testleri çalıştırır.

## Bilinen sınırlar

- Masaüstü, alt satırdaki Agent Team hapını soluk çizer; o yuvada metin renkleri yok sayılır.
  Durum bu yüzden renkle değil düğme türüyle (açık = ana düğme) gösterilir (`hooks/register.tsx`
  içindeki not).
- Bir mod uygulamanın üst araç çubuğuna simge ekleyemez. (Sahibin canlı kullanımdaki gözlemi;
  kodda yok.)
- Eklentinin açtığı pane dar bir pencerede çizilmeden bekleyebilir; `/team-pane` onu açar.
  (Sahibin canlı kullanımdaki gözlemi; kodda yok.)
