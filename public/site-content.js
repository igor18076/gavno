window.StoneAtelierContent = (() => {
  const stones = [
    {
      slug: "opal",
      name: "Опал",
      textureImages: [
        "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1200&q=80"
      ],
      description:
        "Опал ценят за живую игру цвета. В украшениях Stone Atelier он добавляет мягкое сияние и ощущение глубины.",
      symbolism: "Интуиция, вдохновение, мягкая уверенность.",
      shades: ["молочный", "перламутровый", "голубоватый", "радужный"],
      origin: "Эфиопия, Австралия",
      howToWear:
        "Хорошо сочетается с шелком, шерстью и матовыми металлами. Особенно выразителен в вечернем освещении.",
      care: "Избегать пересушивания, хранить отдельно, не чистить абразивами."
    },
    {
      slug: "tourmaline",
      name: "Турмалин",
      textureImages: [
        "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1200&q=80"
      ],
      description:
        "Турмалин дает насыщенный цвет и графичность. Мы используем его в контрастных композициях и строгих силуэтах.",
      symbolism: "Защита, концентрация, внутренняя опора.",
      shades: ["черный", "зеленый", "дымчато-розовый"],
      origin: "Бразилия, Афганистан",
      howToWear: "Подходит к монохромным образам и фактурным тканям, усиливает контраст.",
      care: "Не ронять, избегать ультразвуковой чистки."
    },
    {
      slug: "quartz",
      name: "Кварц",
      textureImages: [
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=1200&q=80"
      ],
      description:
        "Кварц универсален и пластичен по настроению: от прозрачного и спокойного до дымчатого и выразительного.",
      symbolism: "Чистота, баланс, ясность.",
      shades: ["прозрачный", "дымчатый", "розовый", "молочный"],
      origin: "Бразилия, Мадагаскар",
      howToWear: "Легко комбинируется с другими камнями и подходит для многослойных комплектов.",
      care: "Очищать мягкой тканью, не хранить рядом с более твердыми камнями."
    },
    {
      slug: "moonstone",
      name: "Лунный камень",
      textureImages: [
        "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1617038220319-276d3cfab638?auto=format&fit=crop&w=1200&q=80"
      ],
      description:
        "Лунный камень выбирают за деликатное внутреннее свечение. Он делает изделие воздушным и собранным одновременно.",
      symbolism: "Женственность, цикличность, спокойствие.",
      shades: ["молочный", "серо-голубой", "персиковый"],
      origin: "Индия, Шри-Ланка",
      howToWear: "Идеален для повседневных украшений и мягких образов в светлой гамме.",
      care: "Беречь от ударов и резкой смены температуры."
    }
  ];

  const collections = [
    {
      slug: "severny-svet",
      name: "Северный свет",
      concept: "Холодное сияние, воздух и мягкая геометрия",
      inspiration:
        "Коллекция вдохновлена зимним небом, перламутровыми отблесками снега и спокойной северной палитрой.",
      palette: ["ледяной белый", "дымчато-серый", "мягкий синий", "серебристый"],
      keyStones: ["opal", "moonstone", "quartz"],
      coverImage: "https://images.unsplash.com/photo-1543295204-8e6d87c3a2a5?auto=format&fit=crop&w=1600&q=80"
    },
    {
      slug: "nochnaya-gran",
      name: "Ночная грань",
      concept: "Контраст, глубина и графичность",
      inspiration:
        "Линии темного металла и камни с плотным цветом создают коллекцию для вечерних образов и акцентных комплектов.",
      palette: ["угольный", "глубокий зеленый", "дымчатый розовый", "черное серебро"],
      keyStones: ["tourmaline", "quartz"],
      coverImage: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1600&q=80"
    }
  ];

  const reviews = [
    {
      id: "rv1",
      name: "Анна",
      city: "Москва",
      text: "Колье выглядит дороже, чем на фото. Очень аккуратная сборка и красивая упаковка.",
      photo: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
      productSlug: "tourmaline-noir-necklace",
      occasion: "Подарок себе"
    },
    {
      id: "rv2",
      name: "Елена",
      city: "Санкт-Петербург",
      text: "Подобрали длину под вырез платья, серьги и браслет стали комплектом. Очень довольна.",
      photo: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=400&q=80",
      productSlug: "opal-moon-bracelet",
      occasion: "Вечернее мероприятие"
    },
    {
      id: "rv3",
      name: "Марина",
      city: "Казань",
      text: "Люблю натуральные камни, здесь действительно хороший подбор по оттенкам и качеству.",
      photo: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=80",
      productSlug: "moonstone-drop-earrings",
      occasion: "Повседневное"
    },
    {
      id: "rv4",
      name: "Ирина",
      city: "Екатеринбург",
      text: "Сделали под заказ в оговоренный срок, помогли с размером браслета. Посадка идеальная.",
      photo: "https://images.unsplash.com/photo-1541534401786-2077eed87a72?auto=format&fit=crop&w=400&q=80",
      productSlug: "quartz-veil-bracelet",
      occasion: "Подарок"
    },
    {
      id: "rv5",
      name: "Ольга",
      city: "Новосибирск",
      text: "Очень красивый блеск камней и тактильное ощущение ручной работы. Закажу ещё кольцо.",
      photo: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=400&q=80",
      productSlug: "opal-arc-ring",
      occasion: "Юбилей"
    }
  ];

  const products = [
    {
      slug: "opal-moon-bracelet",
      name: "Браслет «Лунный Опал»",
      type: "браслет",
      collection: "severny-svet",
      price: 4900,
      status: "в наличии",
      leadTime: "1–2 дня",
      stones: ["opal", "moonstone", "quartz"],
      metal: "Серебро 925, фурнитура с родиевым покрытием",
      dimensions: { length: "16–19 см", diameter: "4 мм", adjustable: "Да" },
      weight: "12 г",
      description:
        "Многослойный браслет с мягкими перламутровыми оттенками. Собран так, чтобы сияние раскрывалось при движении.",
      stoneStory:
        "Композиция построена вокруг опала и лунного камня: первый дает живой свет, второй — глубину и спокойный отблеск.",
      care:
        "Снимать перед душем и спортом. Хранить в отдельном мягком мешочке. Протирать сухой салфеткой после носки.",
      variations: [
        { id: "br16", label: "16 см", priceDelta: 0 },
        { id: "br18", label: "18 см", priceDelta: 0 },
        { id: "br20", label: "20 см", priceDelta: 300 }
      ],
      images: [
        "https://images.unsplash.com/photo-1617038260897-41a1f14a8ca0?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1543295204-8e6d87c3a2a5?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1602173574767-37ac01994b2a?auto=format&fit=crop&w=1600&q=80"
      ],
      similar: ["moonstone-drop-earrings", "quartz-veil-bracelet", "opal-arc-ring"],
      reviewIds: ["rv2", "rv4"],
      color: "светлый",
      occasion: ["подарок", "повседневное"],
      badges: ["новинка"],
      setSuggestions: ["moonstone-drop-earrings", "opal-arc-ring"]
    },
    {
      slug: "tourmaline-noir-necklace",
      name: "Колье «Черный Турмалин»",
      type: "колье",
      collection: "nochnaya-gran",
      price: 8200,
      status: "в наличии",
      leadTime: "2–3 дня",
      stones: ["tourmaline", "quartz"],
      metal: "Серебро 925, чернение",
      dimensions: { length: "42–48 см", diameter: "6 мм", adjustable: "Да" },
      weight: "26 г",
      description:
        "Графичное колье с турмалином и дымчатым кварцем. Смотрится собранно днем и выразительно вечером.",
      stoneStory:
        "Черный турмалин выбран как центр композиции, а кварц смягчает контраст и добавляет глубину оттенка.",
      care: "Хранить на ровной поверхности, не перегибать тросик, избегать парфюма на поверхности камней.",
      variations: [
        { id: "n42", label: "42 см", priceDelta: 0 },
        { id: "n45", label: "45 см", priceDelta: 250 },
        { id: "n48", label: "48 см", priceDelta: 450 }
      ],
      images: [
        "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1600&q=80"
      ],
      similar: ["tourmaline-geometry-earrings", "smoky-quartz-pendant", "quartz-veil-bracelet"],
      reviewIds: ["rv1"],
      color: "темный",
      occasion: ["вечернее", "повседневное"],
      badges: ["бестселлер"],
      setSuggestions: ["tourmaline-geometry-earrings"]
    },
    {
      slug: "moonstone-drop-earrings",
      name: "Серьги «Лунный Свет»",
      type: "серьги",
      collection: "severny-svet",
      price: 5600,
      status: "под заказ",
      leadTime: "5–7 дней",
      stones: ["moonstone", "opal"],
      metal: "Серебро 925",
      dimensions: { length: "4.5 см", diameter: "8 мм", adjustable: "Нет" },
      weight: "8 г",
      description:
        "Подвесные серьги с мягким свечением. Легкие и подвижные, подходят как для повседневных, так и для вечерних образов.",
      stoneStory:
        "Лунный камень в огранке-капле раскрывает внутреннее свечение, а опаловые вставки усиливают игру света.",
      care: "Хранить отдельно от цепочек, избегать падений и длительного контакта с водой.",
      variations: [
        { id: "hook", label: "Швенза-крючок", priceDelta: 0 },
        { id: "lock", label: "Английский замок", priceDelta: 600 }
      ],
      images: [
        "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1543295204-8e6d87c3a2a5?auto=format&fit=crop&w=1600&q=80"
      ],
      similar: ["opal-moon-bracelet", "opal-arc-ring"],
      reviewIds: ["rv3"],
      color: "светлый",
      occasion: ["подарок", "вечернее"],
      badges: ["лимит"],
      setSuggestions: ["opal-moon-bracelet"]
    },
    {
      slug: "quartz-veil-bracelet",
      name: "Браслет «Дымчатая Вуаль»",
      type: "браслет",
      collection: "nochnaya-gran",
      price: 4300,
      status: "в наличии",
      leadTime: "1–2 дня",
      stones: ["quartz", "tourmaline"],
      metal: "Ювелирная сталь, серебряные акценты",
      dimensions: { length: "15–19 см", diameter: "4–6 мм", adjustable: "Да" },
      weight: "14 г",
      description: "Контрастный браслет с дымчатым кварцем и темными акцентами турмалина.",
      stoneStory: "Дымчатый кварц собран в градиент от прозрачного к насыщенному, турмалин создает ритм композиции.",
      care: "Избегать агрессивной химии и длительного хранения на солнце.",
      variations: [
        { id: "s", label: "S (15–16 см)", priceDelta: 0 },
        { id: "m", label: "M (17–18 см)", priceDelta: 0 },
        { id: "l", label: "L (19 см)", priceDelta: 200 }
      ],
      images: [
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1602173574767-37ac01994b2a?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1600&q=80"
      ],
      similar: ["tourmaline-noir-necklace", "tourmaline-geometry-earrings"],
      reviewIds: ["rv4"],
      color: "дымчатый",
      occasion: ["повседневное", "вечернее"],
      badges: [],
      setSuggestions: ["tourmaline-noir-necklace"]
    },
    {
      slug: "opal-arc-ring",
      name: "Кольцо «Опаловая Дуга»",
      type: "кольцо",
      collection: "severny-svet",
      price: 6100,
      status: "под заказ",
      leadTime: "7–10 дней",
      stones: ["opal", "quartz"],
      metal: "Серебро 925, ручная полировка",
      dimensions: { length: "—", diameter: "камень 7 мм", adjustable: "Размер по выбору" },
      weight: "5 г",
      description: "Кольцо с центральным опалом и деликатной дорожкой кварца в асимметричной посадке.",
      stoneStory: "Опал выбран с мягкой радужной вспышкой, чтобы украшение оставалось благородным и не кричащим.",
      care: "Снимать при уборке и тренировках, хранить в коробке для защиты от царапин.",
      variations: [
        { id: "16", label: "16", priceDelta: 0 },
        { id: "17", label: "17", priceDelta: 0 },
        { id: "18", label: "18", priceDelta: 0 },
        { id: "19", label: "19", priceDelta: 300 }
      ],
      images: [
        "https://images.unsplash.com/photo-1602752250015-52934bc45613?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=1600&q=80"
      ],
      similar: ["moonstone-drop-earrings", "opal-moon-bracelet"],
      reviewIds: ["rv5"],
      color: "светлый",
      occasion: ["подарок", "вечернее"],
      badges: ["лимит", "новинка"],
      setSuggestions: ["moonstone-drop-earrings"]
    },
    {
      slug: "tourmaline-geometry-earrings",
      name: "Серьги «Геометрия Турмалина»",
      type: "серьги",
      collection: "nochnaya-gran",
      price: 4700,
      status: "в наличии",
      leadTime: "1–3 дня",
      stones: ["tourmaline"],
      metal: "Серебро 925, чернение",
      dimensions: { length: "3.8 см", diameter: "5 мм", adjustable: "Нет" },
      weight: "9 г",
      description: "Структурные серьги с четкими линиями и глубоким оттенком турмалина.",
      stoneStory: "Парные камни подобраны по плотности цвета и отражению, чтобы создать визуальную симметрию.",
      care: "Протирать сухой мягкой тканью. Не хранить в сыром помещении.",
      variations: [
        { id: "stud", label: "Пусеты", priceDelta: 0 },
        { id: "hook", label: "Подвесные", priceDelta: 500 }
      ],
      images: [
        "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1600&q=80",
        "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1600&q=80"
      ],
      similar: ["tourmaline-noir-necklace", "quartz-veil-bracelet"],
      reviewIds: ["rv1"],
      color: "темный",
      occasion: ["вечернее"],
      badges: ["бестселлер"],
      setSuggestions: ["tourmaline-noir-necklace"]
    }
  ];

  const processSteps = [
    { title: "Выбор камней", caption: "Отбираем камни по свету, рисунку и оттенку.", image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=1200&q=80" },
    { title: "Подбор пары", caption: "Сравниваем элементы в паре и в ритме будущего изделия.", image: "https://images.unsplash.com/photo-1518546305927-5a555bb7020d?auto=format&fit=crop&w=1200&q=80" },
    { title: "Сборка", caption: "Ручная сборка с проверкой посадки, длины и баланса.", image: "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80" },
    { title: "Полировка", caption: "Финишная обработка металла и контроль креплений.", image: "https://images.unsplash.com/photo-1602752250015-52934bc45613?auto=format&fit=crop&w=1200&q=80" },
    { title: "Финал", caption: "Упаковка, открытка и подготовка к отправке.", image: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1200&q=80" }
  ];

  const packaging = {
    title: "Подарочная упаковка Stone Atelier",
    photo: "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=1600&q=80",
    description:
      "Каждое украшение упаковывается в фирменную коробку с мягкой подложкой и карточкой по уходу. Доступна подарочная опция.",
    giftOption: "Подарочная лента и дополнительная упаковочная бумага",
    postcard: "Открытка с вашим текстом (до 250 символов)"
  };

  const sizeGuide = {
    bracelet: {
      title: "Браслет: измерение запястья",
      steps: ["Измерьте запястье мягкой лентой без натяжения.", "Добавьте 1–1.5 см для комфортной посадки.", "Для свободной посадки добавьте 2 см."],
      table: [
        ["14–15 см", "Размер S"],
        ["16–17 см", "Размер M"],
        ["18–19 см", "Размер L"]
      ]
    },
    necklace: {
      title: "Колье: длина на шее",
      steps: ["Используйте нить и приложите к шее.", "Измерьте желаемую длину линейкой.", "Сверьте с типом выреза одежды."],
      table: [
        ["40–42 см", "База у основания шеи"],
        ["45 см", "Универсальная длина"],
        ["50–60 см", "Для многослойности"]
      ]
    },
    ring: {
      title: "Кольцо: размер",
      steps: ["Измерьте внутренний диаметр своего кольца.", "Или измерьте окружность пальца вечером.", "Уточните сезонность: в жару размер может меняться."],
      table: [
        ["16.0 мм", "Размер 16"],
        ["17.0 мм", "Размер 17"],
        ["18.0 мм", "Размер 18"]
      ]
    }
  };

  const policies = [
    { slug: "delivery", title: "Доставка", body: "Отправка по России и СНГ. Стоимость и сроки зависят от региона и способа доставки. Трек-номер отправляется после передачи заказа в службу доставки." },
    { slug: "returns", title: "Возврат", body: "Возврат возможен для стандартных изделий надлежащего качества в сроки, предусмотренные законодательством. Индивидуальные изделия обсуждаются отдельно." },
    { slug: "warranty", title: "Гарантия", body: "Гарантия на сборку и фурнитуру — 6 месяцев. При аккуратной носке изделия сохраняют внешний вид значительно дольше." },
    { slug: "custom-order", title: "Индивидуальный заказ", body: "Можно собрать украшение под образ, палитру, событие или подарок. В заявке укажите тип изделия, предпочтительные камни и ориентир по бюджету." },
    { slug: "naturalness-certificate", title: "Сертификат натуральности", body: "По запросу предоставляется описание происхождения и характеристик камней, используемых в изделии и конкретной партии." }
  ];

  const footerLinks = [
    { href: "/policies/delivery", label: "Доставка" },
    { href: "/policies/returns", label: "Возврат" },
    { href: "/policies/warranty", label: "Гарантия" },
    { href: "/policies/custom-order", label: "Индивидуальный заказ" },
    { href: "/policies/naturalness-certificate", label: "Сертификат натуральности" },
    { href: "/packaging", label: "Упаковка" },
    { href: "/size-guide", label: "Размеры" }
  ];

  const helpers = {
    stonesBySlug: Object.fromEntries(stones.map((x) => [x.slug, x])),
    collectionsBySlug: Object.fromEntries(collections.map((x) => [x.slug, x])),
    reviewsById: Object.fromEntries(reviews.map((x) => [x.id, x])),
    productsBySlug: {}
  };
  products.forEach((p) => {
    helpers.productsBySlug[p.slug] = p;
  });

  function getProduct(slug) {
    return helpers.productsBySlug[slug] || null;
  }

  function getStone(slug) {
    return helpers.stonesBySlug[slug] || null;
  }

  function getCollection(slug) {
    return helpers.collectionsBySlug[slug] || null;
  }

  function getProductReviews(product) {
    if (!product) return [];
    return (product.reviewIds || []).map((id) => helpers.reviewsById[id]).filter(Boolean);
  }

  function getProductsForStone(stoneSlug) {
    return products.filter((p) => (p.stones || []).includes(stoneSlug));
  }

  function getProductsForCollection(collectionSlug) {
    return products.filter((p) => p.collection === collectionSlug);
  }

  function getRelatedProducts(product) {
    return (product?.similar || []).map(getProduct).filter(Boolean);
  }

  return {
    brandName: "Stone Atelier",
    products,
    stones,
    collections,
    reviews,
    processSteps,
    packaging,
    sizeGuide,
    policies,
    footerLinks,
    helpers: {
      ...helpers,
      getProduct,
      getStone,
      getCollection,
      getProductReviews,
      getProductsForStone,
      getProductsForCollection,
      getRelatedProducts
    }
  };
})();
