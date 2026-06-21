/* Six ready-made instructor profiles, each with niche-specific per-field prompts.
   Loaded by background (importScripts) and options (<script>). */
(function (root) {
  const RAW = [
    {
      id: "iso-xpert", name: "ISO Xpert", fromName: "ISO Xpert",
      role: "Lead Instructor, ISO Compliance & Audit Training",
      prompts: {
        title: "Rewrite as an attention-grabbing, search-friendly ISO/compliance course title of 50–60 characters.",
        subtitle: "Write a clear subtitle explaining the ISO standard, audit, compliance, or certification outcome in 120 characters.",
        description: "Write a professional 250–350 word course description focused on ISO standards, audits, implementation, compliance, and practical workplace use. Use plain text only — no URLs or links, and do not include module or lecture counts.",
        level: "Choose the most accurate level: Beginner, Intermediate, Expert, or All Levels based on ISO complexity.",
        category: "Choose the best Udemy category and sub-category for ISO, quality, safety, compliance, audit, or management systems training.",
        primarilyTaught: "Summarise the main ISO standard, audit method, compliance topic, or management system taught in the course.",
        objectives: "Write 6–8 practical learning outcomes starting with action verbs, focused on ISO implementation, audit preparation, documentation, and compliance.",
        requirements: "List any required ISO knowledge, audit experience, documents, or workplace background. If none, say beginners are welcome.",
        audience: "Describe ideal learners such as QA officers, auditors, managers, HSE professionals, consultants, and compliance teams.",
        welcomeMessage: "Write a warm welcome message from ISO Xpert that clearly introduces the course and encourages professional learning.",
        congratulationsMessage: "Write an encouraging completion message that congratulates learners and motivates them to apply ISO knowledge at work.",
        curriculum: "Group the outline into clear ISO-focused sections with concise, non-duplicate lecture titles."
      }
    },
    {
      id: "nextgen3d", name: "Nextgen3d", fromName: "Nextgen3d",
      role: "3D Printing & Product Design Instructor",
      prompts: {
        title: "Rewrite as a creative, practical, search-friendly course title for 3D printing, CAD, prototyping, or product design.",
        subtitle: "Write a short subtitle explaining the hands-on 3D printing or design skill learners will gain.",
        description: "Write a 250–350 word engaging course description focused on 3D printing, product creation, CAD basics, prototyping, and real project work. Use plain text only — no URLs or links, and do not include module or lecture counts.",
        level: "Choose the most accurate level: Beginner, Intermediate, Expert, or All Levels based on technical difficulty.",
        category: "Choose the best Udemy category and sub-category for 3D printing, design, engineering, STEM, or creative technology.",
        primarilyTaught: "Summarise the main skill taught, such as 3D printing, CAD design, slicing, prototyping, or product development.",
        objectives: "Write 6–8 learning outcomes focused on designing, preparing, printing, troubleshooting, and improving 3D models.",
        requirements: "List required tools such as laptop, CAD software, slicer, or 3D printer. If not required, mention beginners can follow along.",
        audience: "Describe learners such as makers, students, designers, hobbyists, engineers, teachers, and small business creators.",
        welcomeMessage: "Write a friendly welcome message from Nextgen3d that inspires learners to create practical 3D printed projects.",
        congratulationsMessage: "Write a motivational completion message encouraging learners to keep designing, printing, testing, and improving their ideas.",
        curriculum: "Group the course into practical sections covering design, slicing, printing setup, troubleshooting, and final projects."
      }
    },
    {
      id: "pti", name: "Professional Training Institute (PTI)", fromName: "Professional Training Institute (PTI)",
      role: "Corporate & Professional Skills Training Provider",
      prompts: {
        title: "Rewrite as a professional, workplace-focused course title suitable for corporate and technical training.",
        subtitle: "Write a clear subtitle explaining the professional skill, workplace outcome, or technical capability learners will develop.",
        description: "Write a 250–350 word course description focused on practical workplace learning, professional development, safety, technical skills, or soft skills. Use plain text only — no URLs or links, and do not include module or lecture counts.",
        level: "Choose Beginner, Intermediate, Expert, or All Levels based on learner experience and workplace difficulty.",
        category: "Choose the best Udemy category and sub-category for corporate training, professional development, safety, technical, or workplace skills.",
        primarilyTaught: "Summarise the main professional, technical, safety, or workplace skill taught in the course.",
        objectives: "Write 6–8 practical outcomes focused on workplace application, confidence, skill improvement, and job performance.",
        requirements: "List required workplace experience, tools, or knowledge. If none, mention no prior experience is required.",
        audience: "Describe employees, supervisors, technicians, managers, fresh graduates, corporate teams, and professionals seeking growth.",
        welcomeMessage: "Write a formal but encouraging welcome message from PTI focused on practical learning and professional improvement.",
        congratulationsMessage: "Write a professional completion message encouraging learners to apply the skills in real workplace situations.",
        curriculum: "Organize the outline into structured training modules with clear workplace-focused lecture titles."
      }
    },
    {
      id: "nexus-life", name: "Nexus Life Academy", fromName: "Nexus Life Academy",
      role: "Life Skills, Leadership & Personal Growth Coach",
      prompts: {
        title: "Rewrite as an inspiring, benefit-driven course title for life skills, leadership, productivity, communication, or personal growth.",
        subtitle: "Write a clear subtitle showing the personal, career, or leadership transformation learners can expect.",
        description: "Write a 250–350 word course description focused on personal development, communication, confidence, productivity, leadership, and practical life improvement. Use plain text only — no URLs or links, and do not include module or lecture counts.",
        level: "Choose Beginner, Intermediate, Expert, or All Levels based on the depth of personal development content.",
        category: "Choose the best Udemy category and sub-category for personal development, leadership, productivity, communication, or career growth.",
        primarilyTaught: "Summarise the main life skill, mindset, leadership, productivity, or communication topic taught in the course.",
        objectives: "Write 6–8 action-based outcomes focused on confidence, communication, decision-making, leadership, productivity, and personal growth.",
        requirements: "List any self-reflection, journal, or basic life experience needed. If none, say learners only need an open mindset.",
        audience: "Describe students, professionals, leaders, job seekers, entrepreneurs, and anyone seeking personal or career growth.",
        welcomeMessage: "Write a warm and inspiring welcome message from Nexus Life Academy that motivates learners to start improving their life skills.",
        congratulationsMessage: "Write an uplifting completion message encouraging learners to continue practicing and applying what they learned.",
        curriculum: "Group the course into personal growth sections with clear, motivating, non-repeated lecture titles."
      }
    },
    {
      id: "veloxa-labs", name: "Veloxa Labs", fromName: "Veloxa Labs",
      role: "AI, Automation & Technology Instructor",
      prompts: {
        title: "Rewrite as a modern, search-friendly technology course title for AI, automation, software, data, or innovation.",
        subtitle: "Write a concise subtitle explaining the technical skill, tool, project, or automation outcome learners will build.",
        description: "Write a 250–350 word course description focused on hands-on technology learning, AI tools, automation workflows, coding, data, or digital innovation. Use plain text only — no URLs or links, and do not include module or lecture counts.",
        level: "Choose Beginner, Intermediate, Expert, or All Levels based on coding, AI, automation, or technical complexity.",
        category: "Choose the best Udemy category and sub-category for AI, software development, automation, data, IT, or technology.",
        primarilyTaught: "Summarise the main technical topic taught, such as AI automation, app development, workflow automation, data analysis, or software tools.",
        objectives: "Write 6–8 practical learning outcomes focused on building, automating, testing, improving, and deploying technical solutions.",
        requirements: "List any laptop, software, coding knowledge, accounts, or tools needed. If none, say beginners can start with basic computer skills.",
        audience: "Describe developers, IT professionals, students, business owners, automation builders, data learners, and tech enthusiasts.",
        welcomeMessage: "Write a modern welcome message from Veloxa Labs that encourages learners to build practical technology solutions.",
        congratulationsMessage: "Write an energetic completion message encouraging learners to keep experimenting, improving, and applying technology skills.",
        curriculum: "Group the outline into hands-on technical sections with project-based, clear lecture titles."
      }
    },
    {
      id: "vertex-business", name: "Vertex Business Academy", fromName: "Vertex Business Academy",
      role: "Business, Management & Entrepreneurship Instructor",
      prompts: {
        title: "Rewrite as a professional, business-focused, search-friendly course title for management, entrepreneurship, sales, finance, or operations.",
        subtitle: "Write a strong subtitle showing the business skill, growth outcome, or management capability learners will gain.",
        description: "Write a 250–350 word course description focused on business growth, entrepreneurship, management, finance, marketing, sales, or operations. Use plain text only — no URLs or links, and do not include module or lecture counts.",
        level: "Choose Beginner, Intermediate, Expert, or All Levels based on the business knowledge required.",
        category: "Choose the best Udemy category and sub-category for business, entrepreneurship, management, finance, marketing, sales, or operations.",
        primarilyTaught: "Summarise the main business topic taught, such as business planning, leadership, sales strategy, finance, marketing, or operations.",
        objectives: "Write 6–8 practical outcomes focused on planning, managing, selling, analyzing, growing, and improving a business.",
        requirements: "List any business knowledge, spreadsheet skills, startup idea, or work experience needed. If none, mention beginners are welcome.",
        audience: "Describe entrepreneurs, business owners, managers, students, sales teams, marketers, finance learners, and professionals.",
        welcomeMessage: "Write a confident welcome message from Vertex Business Academy focused on practical business growth and professional success.",
        congratulationsMessage: "Write a strong completion message encouraging learners to apply the business tools and strategies in real situations.",
        curriculum: "Organize the outline into business-focused modules with practical, clear, non-duplicate lecture titles."
      }
    }
  ];

  function build(p) {
    const fields = {};
    Object.keys(p.prompts).forEach((k) => { fields[k] = { en: true, prompt: p.prompts[k] }; });
    return { id: p.id, name: p.name, fromName: p.fromName, role: p.role, fields };
  }

  root.SeedProfiles = RAW.map(build);
})(typeof self !== "undefined" ? self : this);
