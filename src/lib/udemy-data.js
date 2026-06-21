/* Udemy taxonomy + form constraints. Loaded in background (importScripts) and popup (<script>). */
(function (root) {
  const levels = ["Beginner Level", "Intermediate Level", "Expert Level", "All Levels"];

  // Top categories -> subcategories (approximation of Udemy's public taxonomy).
  // Used to (a) constrain the model to valid choices and (b) match <select> options.
  const taxonomy = {
    "Development": ["Web Development", "Data Science", "Mobile Development", "Programming Languages", "Game Development", "Database Design & Development", "Software Testing", "Software Engineering", "Software Development Tools", "No-Code Development"],
    "Business": ["Entrepreneurship", "Communication", "Management", "Sales", "Business Strategy", "Operations", "Project Management", "Business Law", "Business Analytics & Intelligence", "Human Resources", "Industry", "E-Commerce", "Media", "Real Estate", "Other Business"],
    "Finance & Accounting": ["Accounting & Bookkeeping", "Compliance", "Cryptocurrency & Blockchain", "Economics", "Finance", "Finance Cert & Exam Prep", "Financial Modeling & Analysis", "Investing & Trading", "Money Management Tools", "Taxes", "Other Finance & Accounting"],
    "IT & Software": ["IT Certifications", "Network & Security", "Hardware", "Operating Systems & Servers", "Other IT & Software"],
    "Office Productivity": ["Microsoft", "Apple", "Google", "SAP", "Oracle", "Other Office Productivity"],
    "Personal Development": ["Personal Transformation", "Personal Productivity", "Leadership", "Career Development", "Parenting & Relationships", "Happiness", "Esoteric Practices", "Religion & Spirituality", "Personal Brand Building", "Creativity", "Influence", "Self Esteem & Confidence", "Stress Management", "Memory & Study Skills", "Motivation", "Other Personal Development"],
    "Design": ["Web Design", "Graphic Design & Illustration", "Design Tools", "User Experience Design", "Game Design", "3D & Animation", "Fashion Design", "Architectural Design", "Interior Design", "Other Design"],
    "Marketing": ["Digital Marketing", "Search Engine Optimization", "Social Media Marketing", "Branding", "Marketing Fundamentals", "Marketing Analytics & Automation", "Public Relations", "Paid Advertising", "Video & Mobile Marketing", "Content Marketing", "Growth Hacking", "Affiliate Marketing", "Product Marketing", "Other Marketing"],
    "Lifestyle": ["Arts & Crafts", "Beauty & Makeup", "Esoteric Practices", "Food & Beverage", "Gaming", "Home Improvement & Gardening", "Pet Care & Training", "Travel", "Other Lifestyle"],
    "Photography & Video": ["Digital Photography", "Photography", "Portrait Photography", "Photography Tools", "Commercial Photography", "Video Design", "Other Photography & Video"],
    "Health & Fitness": ["Fitness", "General Health", "Sports", "Nutrition & Diet", "Yoga", "Mental Health", "Martial Arts & Self Defense", "Safety & First Aid", "Dance", "Meditation", "Other Health & Fitness"],
    "Music": ["Instruments", "Music Production", "Music Fundamentals", "Vocal", "Music Techniques", "Music Software", "Other Music"],
    "Teaching & Academics": ["Engineering", "Humanities", "Math", "Science", "Online Education", "Social Science", "Language Learning", "Teacher Training", "Test Prep", "Other Teaching & Academics"]
  };

  const limits = {
    titleMax: 60,
    subtitleMax: 120,
    objectiveMax: 160,
    descriptionMinWords: 250,
    descriptionMaxWords: 350,
    minObjectives: 4,
    messageMax: 1000
  };

  // canonical list of improvable fields (per-profile prompts & enable/disable target these).
  // `defaultPrompt` is shown pre-filled in Settings; leaving it unchanged uses the fast built-in
  // improvement, while editing it turns that field into a custom override.
  const fields = [
    { key: "title", label: "Course title", page: "basics", defaultPrompt: "Rewrite as an attention-grabbing, search-friendly Udemy title of 50–60 characters." },
    { key: "subtitle", label: "Course subtitle", page: "basics", defaultPrompt: "Write a compelling subtitle (max 120 characters) with 1–2 keywords and 3–4 key areas covered." },
    { key: "description", label: "Course description", page: "basics", defaultPrompt: "Write an engaging, benefit-driven description of 250–350 words in plain text. Start with the required AI sentence. No URLs or links, and do not include module or lecture counts." },
    { key: "level", label: "Level", page: "basics", defaultPrompt: "Choose the most accurate level: Beginner, Intermediate, Expert, or All Levels." },
    { key: "category", label: "Category & sub-category", page: "basics", defaultPrompt: "Choose the single best-fitting Udemy category and sub-category for this course." },
    { key: "primarilyTaught", label: "Primarily taught", page: "basics", defaultPrompt: "Summarise the main skill or topic taught, in a short phrase." },
    { key: "objectives", label: "What will students learn", page: "goals", defaultPrompt: "Write 6–8 outcome-focused points, each starting with an action verb (max 160 characters each)." },
    { key: "requirements", label: "Requirements / prerequisites", page: "goals", defaultPrompt: "List the prerequisites, skills or tools needed; if none, reassure beginners." },
    { key: "audience", label: "Who is this course for", page: "goals", defaultPrompt: "Describe the ideal learners as 3–5 short audience lines." },
    { key: "welcomeMessage", label: "Welcome message", page: "messages", defaultPrompt: "Write a warm welcome that names the course and is clearly from the instructor/profile." },
    { key: "congratulationsMessage", label: "Congratulations message", page: "messages", defaultPrompt: "Write an encouraging congratulations that names the course and is from the instructor/profile." },
    { key: "curriculum", label: "Curriculum", page: "curriculum", defaultPrompt: "Group the outline into clear sections with concise, non-duplicate lecture titles." }
  ];

  root.UdemyData = {
    levels,
    taxonomy,
    categories: Object.keys(taxonomy),
    fields,
    limits,
    flatCategoryList() {
      const out = [];
      for (const [cat, subs] of Object.entries(taxonomy)) {
        out.push(`${cat}: ${subs.join(", ")}`);
      }
      return out.join("\n");
    }
  };
})(typeof self !== "undefined" ? self : this);
